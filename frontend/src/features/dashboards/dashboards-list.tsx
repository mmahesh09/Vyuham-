"use client";

import { formatDistanceToNow } from "date-fns";
import { ArrowRight, Globe, LayoutDashboard, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useMe } from "@/features/auth/hooks";
import { useDatasets } from "@/features/datasets/api";
import { cn } from "@/lib/utils";

import { useCreateDashboard, useDashboards, useStarterDashboard } from "./hooks";

const selectClass = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-text";

/** New dashboard: blank, or built for you from a dataset's columns. */
function NewDashboardDialog() {
  const router = useRouter();
  const { data: datasets } = useDatasets();
  const create = useCreateDashboard();
  const starter = useStarterDashboard();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"starter" | "blank">("starter");
  const [modeChosen, setModeChosen] = useState(false);
  const [name, setName] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const pending = create.isPending || starter.isPending;
  const error = (mode === "blank" ? create.error : starter.error)?.message;
  const hasData = !!datasets?.length;

  // Datasets can arrive after the dialog opens: default to "build it for me" unless the user chose.
  useEffect(() => {
    if (!open || !datasets) return;
    if (!datasetId && datasets[0]) setDatasetId(datasets[0].id);
    if (!modeChosen) setMode(datasets.length ? "starter" : "blank");
  }, [open, datasets, datasetId, modeChosen]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setModeChosen(false);
          setMode(hasData ? "starter" : "blank");
          setDatasetId(datasets?.[0]?.id ?? "");
          setName("");
          create.reset();
          starter.reset();
        }
      }}
    >
      <DialogTrigger render={<Button />}>
        <Plus /> New dashboard
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New dashboard</DialogTitle>
          <DialogDescription>Start from your data and edit from there, or begin with a blank page.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            const go = { onSuccess: (d: { id: string }) => router.push(`/dashboards/${d.id}`) };
            if (mode === "starter" && datasetId) starter.mutate(datasetId, go);
            else if (name.trim()) create.mutate({ name: name.trim() }, go);
          }}
        >
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How to start">
            {(
              [
                ["starter", "Build it for me", "Key numbers and charts picked from your columns", Sparkles],
                ["blank", "Blank", "Add charts one by one", LayoutDashboard],
              ] as const
            ).map(([value, label, hint, Icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                disabled={value === "starter" && !hasData}
                onClick={() => (setMode(value), setModeChosen(true))}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border border-line p-3 text-left hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50",
                  mode === value && "border-primary bg-line/40",
                )}
              >
                <Icon className="size-4 text-highlight" />
                <span className="text-sm font-semibold">{label}</span>
                <span className="text-xs text-muted">{hint}</span>
              </button>
            ))}
          </div>
          {mode === "starter" ? (
            <Field>
              <FieldLabel htmlFor="nd-dataset">From dataset</FieldLabel>
              <select id="nd-dataset" className={selectClass} value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
                {datasets?.map((d) => (
                  <option key={d.id} value={d.id} className="bg-surface">
                    {d.name}
                  </option>
                ))}
              </select>
              <FieldDescription>You can rename it, and add, edit or remove any chart afterwards.</FieldDescription>
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="nd-name">Name</FieldLabel>
              <Input id="nd-name" autoFocus value={name} maxLength={200} required placeholder="e.g. Monthly sales" onChange={(e) => setName(e.target.value)} />
            </Field>
          )}
          {!hasData && (
            <p className="text-sm text-muted">
              No datasets yet.{" "}
              <Link href="/data" className="text-highlight underline">
                Add one on the Data page
              </Link>{" "}
              to have a dashboard built for you.
            </p>
          )}
          {error && <p className="text-[13px] text-accent">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending || (mode === "blank" ? !name.trim() : !datasetId)}>
              {pending ? "Creating…" : mode === "starter" ? "Build dashboard" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DashboardsList() {
  const { data, isPending, isError } = useDashboards();
  const { data: me } = useMe();
  const canEdit = me?.role !== "viewer";

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-8 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[38px] font-semibold tracking-[-0.03em]">Dashboards</h1>
          <p className="text-[15px] text-muted">Each dashboard is a feed of insights from your data, with filters that apply to every chart.</p>
        </div>
        {canEdit && <NewDashboardDialog />}
      </div>

      {isError && <p className="text-sm text-accent">We couldn’t load your dashboards. Refresh to try again.</p>}
      {isPending && (
        <ul className="grid gap-4 md:grid-cols-2" aria-busy>
          {[0, 1].map((i) => (
            <li key={i} className="h-40 animate-pulse rounded-[18px] bg-surface" />
          ))}
        </ul>
      )}
      {data?.length === 0 && (
        <Empty className="border border-dashed border-line py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutDashboard />
            </EmptyMedia>
            <EmptyTitle>No dashboards yet</EmptyTitle>
            <EmptyDescription>Create one from a dataset and we&apos;ll pick the first charts for you.</EmptyDescription>
          </EmptyHeader>
          {canEdit && (
            <EmptyContent>
              <NewDashboardDialog />
            </EmptyContent>
          )}
        </Empty>
      )}
      {!!data?.length && (
        <ul className="grid gap-4 md:grid-cols-2">
          {data.map((d) => (
            <li key={d.id}>
              <Link
                href={`/dashboards/${d.id}`}
                className="group flex min-h-40 flex-col justify-between gap-6 rounded-[18px] border border-line bg-surface p-6 transition-colors hover:border-primary/60"
              >
                <span className="flex items-start justify-between gap-3">
                  <LayoutDashboard className="size-6 text-highlight" strokeWidth={1.7} aria-hidden />
                  {d.shared && (
                    <span className="inline-flex items-center gap-1 rounded-[4px] bg-line px-2 py-0.5 text-xs font-semibold text-highlight">
                      <Globe className="size-3" aria-hidden /> Shared
                    </span>
                  )}
                </span>
                <span className="flex items-end justify-between gap-4">
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-xl font-semibold text-text">{d.name}</span>
                    <span className="truncate text-sm text-muted">
                      {d.kpi_count} numbers · {d.chart_count} charts{d.dataset_names.length ? ` · ${d.dataset_names.join(", ")}` : ""}
                    </span>
                    <span className="text-xs text-faint">Updated {formatDistanceToNow(new Date(d.updated_at), { addSuffix: true })}</span>
                  </span>
                  <ArrowRight className="size-5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-text" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
