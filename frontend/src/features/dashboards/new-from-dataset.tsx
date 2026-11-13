"use client";

import { LayoutDashboard, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageContainer } from "@/components/app/page-container";

import { useStarterDashboard } from "./hooks";

/** /dashboards/new?dataset=… : builds a starter dashboard from the dataset, then opens it. */
export function NewFromDataset({ datasetId }: { datasetId: string | null }) {
  const router = useRouter();
  const starter = useStarterDashboard();
  const started = useRef(false);

  useEffect(() => {
    if (!datasetId || started.current) return;
    started.current = true; // once, even under StrictMode's double effects
    starter.mutate(datasetId, { onSuccess: (d) => router.replace(`/dashboards/${d.id}`) });
  }, [datasetId, starter, router]);

  if (!datasetId || starter.isError)
    return (
      <PageContainer width="narrow" className="pt-6">
        <EmptyState
          icon={<LayoutDashboard />}
          title={starter.isError ? "We couldn't build that dashboard" : "Pick a dataset first"}
          description={starter.error?.message ?? "Open a dataset and choose Build a dashboard, or start from the Dashboards page."}
          action={
            <Link href="/dashboards" className="text-sm text-highlight hover:underline">
              Back to dashboards
            </Link>
          }
        />
      </PageContainer>
    );
  return (
    <div className="flex h-72 flex-col items-center justify-center gap-3 text-muted" role="status">
      <LoaderCircle className="size-6 animate-spin text-highlight" aria-hidden />
      Picking the first charts from your columns…
    </div>
  );
}
