"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

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
      <div className="mx-auto flex max-w-[640px] flex-col gap-3 pt-16">
        <p role="alert" className="text-muted">{starter.error?.message ?? "Pick a dataset to build a dashboard from."}</p>
        <Link href="/dashboards" className="text-highlight underline">Back to dashboards</Link>
      </div>
    );
  return (
    <div className="flex h-72 flex-col items-center justify-center gap-3 text-muted" role="status">
      <LoaderCircle className="size-6 animate-spin text-highlight" aria-hidden />
      Picking the first charts from your columns…
    </div>
  );
}
