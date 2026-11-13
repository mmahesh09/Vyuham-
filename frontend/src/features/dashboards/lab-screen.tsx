"use client";

import { formatDistanceToNow } from "date-fns";
import { LayoutGrid, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useMe } from "@/features/auth/hooks";
import { useDatasets } from "@/features/datasets/api";

import { useDashboards, useStarterDashboard } from "./hooks";

/** Dashboard Lab: open any dashboard as a free-form canvas, or start one from a dataset. */
export function LabScreen() {
  const router = useRouter();
  const { data: me } = useMe();
  const { data: dashboards, isPending } = useDashboards();
  const { data: datasets } = useDatasets();
  const starter = useStarterDashboard();
  const [datasetId, setDatasetId] = useState("");
  const canEdit = me?.role !== "viewer";
  const chosen = datasetId || datasets?.[0]?.id || "";

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard Lab"
        description={
          <>
            Lay out any dashboard on a free-form canvas: drag charts anywhere, make them big or small. The story view keeps its own order.
          </>
        }
        actions={
          <>
            {canEdit && !!datasets?.length && (
              <div className="flex items-center gap-2">
                <select
                  aria-label="Dataset for a new canvas"
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm text-text"
                  value={chosen}
                  onChange={(e) => setDatasetId(e.target.value)}
                >
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id} className="bg-surface">
                      {d.name}
                    </option>
                  ))}
                </select>
                <Button
                  disabled={!chosen || starter.isPending}
                  onClick={() => starter.mutate(chosen, { onSuccess: (d) => router.push(`/dashboards/${d.id}?layout=canvas`) })}
                >
                  <Sparkles /> {starter.isPending ? "Building…" : "New canvas"}
                </Button>
              </div>
            )}
          </>
        }
      />
      {starter.isError && <p className="text-sm text-accent">{starter.error.message}</p>}

      {isPending ? (
        <div className="h-40 animate-pulse rounded-[18px] bg-surface" />
      ) : !dashboards?.length ? (
        <Empty className="border border-dashed border-line py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutGrid />
            </EmptyMedia>
            <EmptyTitle>No dashboards yet</EmptyTitle>
            <EmptyDescription>Start a canvas from a dataset above, or create a dashboard first.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {dashboards.map((d) => (
            <li key={d.id}>
              <Link
                href={`/dashboards/${d.id}?layout=canvas`}
                className="group flex h-full flex-col gap-4 rounded-[18px] border border-line bg-surface p-5 transition-colors hover:border-primary/60"
              >
                {/* A little preview of the grid */}
                <span className="grid h-20 grid-cols-6 grid-rows-3 gap-1" aria-hidden>
                  {Array.from({ length: Math.min(d.kpi_count, 4) }).map((_, i) => (
                    <span key={`k${i}`} className="col-span-3 rounded bg-line/70 sm:col-span-2" />
                  ))}
                  {Array.from({ length: Math.min(d.chart_count, 4) }).map((_, i) => (
                    <span key={`c${i}`} className="col-span-3 row-span-2 rounded bg-primary/30" />
                  ))}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="truncate font-semibold">{d.name}</span>
                  <span className="text-xs text-faint">
                    {d.kpi_count + d.chart_count} charts · updated {formatDistanceToNow(new Date(d.updated_at), { addSuffix: true })}
                  </span>
                </span>
                <span className="mt-auto text-sm font-medium text-highlight group-hover:underline">Open in canvas →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
