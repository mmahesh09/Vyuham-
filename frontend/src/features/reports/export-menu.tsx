"use client";

import { Download, FileSpreadsheet, FileText, LoaderCircle, Sheet } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { DEFAULT_OPTIONS, FORMAT_LABEL, downloadUrl, isActive, useExport, useReportRun, type ReportFormat, type ReportOptions, type ReportSource } from "./api";

const FORMATS: { format: ReportFormat; label: string; icon: typeof FileText; hint: string }[] = [
  { format: "pdf", label: "PDF", icon: FileText, hint: "The dashboard as it looks, for sharing" },
  { format: "xlsx", label: "Excel", icon: FileSpreadsheet, hint: "A sheet per chart, plus a summary" },
  { format: "csv", label: "CSV", icon: Sheet, hint: "Plain data, for other tools" },
];

type Props = {
  source: ReportSource;
  sourceId: string;
  /** For dashboards: the period and filters on screen, so the file matches what you see. */
  options?: Partial<ReportOptions>;
  disabled?: boolean;
};

/** "Export" button: queues a file, shows progress, and downloads it when it's ready. */
export function ExportMenu({ source, sourceId, options, disabled }: Props) {
  const exp = useExport();
  const [runId, setRunId] = useState<string | null>(null);
  const run = useReportRun(runId);
  const downloaded = useRef<string | null>(null);
  const formats = source === "dashboard" ? FORMATS : FORMATS.filter((f) => f.format !== "pdf");

  // Start the download once, as soon as the file is ready.
  useEffect(() => {
    const r = run.data;
    if (r?.status !== "done" || downloaded.current === r.id) return;
    downloaded.current = r.id;
    const a = document.createElement("a");
    a.href = downloadUrl(r.id);
    a.download = r.file_name ?? "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [run.data]);

  const busy = exp.isPending || (!!run.data && isActive(run.data)) || (!!runId && run.isPending);
  const start = (format: ReportFormat) => {
    setRunId(null);
    exp.mutate({ source, source_id: sourceId, format, options: { ...DEFAULT_OPTIONS, ...options } }, { onSuccess: (r) => setRunId(r.id) });
  };
  const status = exp.error?.message ?? (run.data?.status === "failed" ? run.data.error : null);

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" disabled={disabled || busy} />}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Download aria-hidden />}
          {busy ? `Preparing ${run.data ? FORMAT_LABEL[run.data.format] : "file"}…` : "Export"}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Download as</DropdownMenuLabel>
          {formats.map(({ format, label, icon: Icon, hint }) => (
            <DropdownMenuItem key={format} onClick={() => start(format)} className="items-start">
              <Icon className="mt-0.5" aria-hidden />
              <span className="flex flex-col">
                <span>{label}</span>
                <span className="text-xs text-faint">{hint}</span>
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link href="/reports" />}>Saved reports and history</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span aria-live="polite" className="text-[13px]">
        {status ? (
          <span role="alert" className="text-accent">{status}</span>
        ) : run.data?.status === "done" ? (
          <a href={downloadUrl(run.data.id)} className="text-highlight underline-offset-2 hover:underline">
            Download again
          </a>
        ) : null}
      </span>
    </div>
  );
}
