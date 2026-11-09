"use client";

import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, Check, FileSpreadsheet, LayoutDashboard, ListTodo, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/features/auth/hooks";
import { TaskDialog } from "@/features/team/task-dialog";

import { useDataset, useDeleteDataset, useReplaceDatasetFile, useUpdateDataset, type Dataset } from "./api";
import { TypeBadge } from "./column-summary";
import { DatasetGrid } from "./dataset-grid";
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
      <div className="mx-auto flex max-w-[1100px] flex-col items-start gap-4 pt-10">
        <p role="alert" className="text-muted">
          {error.message === "Dataset not found" ? "This dataset doesn't exist, or it was deleted." : error.message}
        </p>
        <Button variant="outline" nativeButton={false} render={<Link href="/data" />}>
          <ArrowLeft /> Back to data
        </Button>
      </div>
    );
  return <DatasetView dataset={dataset} />;
}

function DatasetView({ dataset }: { dataset: Dataset }) {
  const router = useRouter();
  const { data: me } = useMe();
  const canEdit = me?.role !== "viewer";
  const update = useUpdateDataset(dataset.id);
  const replace = useReplaceDatasetFile(dataset.id);
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
    <div className="mx-auto flex max-w-[1100px] flex-col gap-7 pt-2">
      <Link href="/data" className="inline-flex w-fit items-center gap-1.5 text-sm text-faint hover:text-text">
        <ArrowLeft className="size-4" aria-hidden /> All data
      </Link>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
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
                className="h-11 max-w-md text-xl font-semibold"
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
              <h1 className="truncate text-[clamp(28px,3.4vw,38px)] font-semibold tracking-[-0.03em]">{dataset.name}</h1>
              {canEdit && (
                <Button variant="ghost" size="icon-sm" aria-label="Rename dataset" onClick={() => setRenaming(true)}>
                  <Pencil />
                </Button>
              )}
            </div>
          )}
          {update.isError && <p className="text-[13px] text-accent">{update.error.message}</p>}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted">
            <FileSpreadsheet className="size-4 text-highlight" aria-hidden />
            <span>{dataset.source_filename}{dataset.sheet ? ` · ${dataset.sheet}` : ""}</span>
            <span aria-hidden>·</span>
            <span>{nf.format(dataset.row_count)} rows</span>
            <span aria-hidden>·</span>
            <span>{dataset.columns.length} columns</span>
            <span aria-hidden>·</span>
            <span>{formatBytes(dataset.file_size)}</span>
            <span aria-hidden>·</span>
            <span>updated {formatDistanceToNow(new Date(dataset.updated_at ?? dataset.created_at), { addSuffix: true })}</span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
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
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={replace.isPending}>
                <RefreshCw className={replace.isPending ? "animate-spin" : ""} /> {replace.isPending ? "Replacing…" : "Replace file"}
              </Button>
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
        </div>
      </header>

      {(replaceError || replace.isSuccess) && (
        <p role="status" className={replaceError ? "text-sm text-accent" : "text-sm text-highlight"}>
          {replaceError ?? `Replaced with ${dataset.source_filename}. Dashboards using this dataset now show the new data.`}
        </p>
      )}

      <Tabs defaultValue="rows">
        <TabsList>
          <TabsTrigger value="rows">Rows</TabsTrigger>
          <TabsTrigger value="columns">Columns</TabsTrigger>
        </TabsList>
        <TabsContent value="rows" className="pt-4">
          <DatasetGrid dataset={dataset} />
        </TabsContent>
        <TabsContent value="columns" className="pt-4">
          <ColumnsPanel dataset={dataset} canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Detected column types, with an override when we guessed wrong. */
function ColumnsPanel({ dataset, canEdit }: { dataset: Dataset; canEdit: boolean }) {
  const update = useUpdateDataset(dataset.id);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        We guessed each column&apos;s type from its values. If one is wrong, change it here; charts use the new type straight away.
      </p>
      {update.isError && <p className="text-[13px] text-accent">{update.error.message}</p>}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {dataset.columns.map((c) => (
          <li key={c.name} className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <code className="truncate font-mono text-[13px] text-text" title={c.name}>
                {c.name}
              </code>
              <TypeBadge type={c.type} />
            </div>
            <p className="truncate text-[13px] text-muted">{c.examples.length ? c.examples.join(" · ") : "No values"}</p>
            {c.empty_ratio > 0.2 && <p className="text-xs text-accent">{Math.round(c.empty_ratio * 100)}% of cells are empty</p>}
            {canEdit && (
              <label className="flex items-center gap-2 text-xs text-faint">
                Treat as
                <select
                  value={c.type}
                  disabled={update.isPending}
                  onChange={(e) => update.mutate({ column_types: { [c.name]: e.target.value as ColumnType } })}
                  className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-[13px] text-text"
                  aria-label={`Type of ${c.name}`}
                >
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value} className="bg-surface">
                      {t.label} — {t.hint}
                    </option>
                  ))}
                </select>
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
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 pt-6" aria-busy>
      <div className="h-10 w-72 animate-pulse rounded-lg bg-surface" />
      <div className="h-5 w-96 animate-pulse rounded bg-surface" />
      <div className="h-[420px] animate-pulse rounded-[16px] bg-surface" />
    </div>
  );
}
