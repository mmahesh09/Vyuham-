"use client";

import { formatDistanceToNow } from "date-fns";
import { ChevronRight, Globe, LayoutDashboard, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { InlineAlert } from "@/components/app/inline-alert";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/features/auth/hooks";
import { useDatasets } from "@/features/datasets/api";
import { cn } from "@/lib/utils";

import { useCreateDashboard, useDashboards, useStarterDashboard } from "./hooks";

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
              <NativeSelect id="nd-dataset" className="w-full" value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
                {datasets?.map((d) => (
                  <option key={d.id} value={d.id} className="bg-surface">
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
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
    <PageContainer>
      <PageHeader
        title="Dashboards"
        description="Each dashboard is a feed of insights from your data, with filters that apply to every chart."
        actions={
          <>
            {canEdit && <NewDashboardDialog />}
          </>
        }
      />

      {isError && <InlineAlert>We couldn’t load your dashboards. Refresh the page to try again.</InlineAlert>}
      {isPending && (
        <div className="flex flex-col gap-2" aria-busy>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[68px] rounded-lg" />
          ))}
        </div>
      )}
      {data?.length === 0 && (
        <EmptyState
          icon={<LayoutDashboard />}
          title="No dashboards yet"
          description="Create one from a dataset and we'll pick the first charts for you."
          action={canEdit ? <NewDashboardDialog /> : undefined}
        />
      )}
      {!!data?.length && (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface" aria-label="Dashboards">
          {data.map((d) => (
            <li key={d.id}>
              <Link
                href={`/dashboards/${d.id}`}
                className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 transition-colors hover:bg-surface-2/70 sm:px-5 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,14rem)_8rem_auto]"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-line text-highlight" aria-hidden>
                  <LayoutDashboard className="size-[18px]" strokeWidth={1.7} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[15px] font-semibold text-text">{d.name}</span>
                    {d.shared && (
                      <Badge variant="secondary" className="shrink-0 gap-1 rounded-sm bg-line text-highlight">
                        <Globe className="size-3" aria-hidden /> Shared
                      </Badge>
                    )}
                  </span>
                  <span className="truncate text-[13px] text-faint">
                    {d.kpi_count} {d.kpi_count === 1 ? "number" : "numbers"}, {d.chart_count} {d.chart_count === 1 ? "chart" : "charts"}
                    <span className="md:hidden">{d.dataset_names.length ? `, from ${d.dataset_names.join(", ")}` : ""}</span>
                  </span>
                </span>
                <span className="truncate text-[13px] text-muted max-md:hidden" title={d.dataset_names.join(", ")}>
                  {d.dataset_names.length ? d.dataset_names.join(", ") : <span className="text-faint">No dataset</span>}
                </span>
                <span className="text-right text-[13px] text-faint max-md:hidden">
                  {formatDistanceToNow(new Date(d.updated_at), { addSuffix: true })}
                </span>
                <ChevronRight className="size-4 text-line-strong transition-colors group-hover:text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
