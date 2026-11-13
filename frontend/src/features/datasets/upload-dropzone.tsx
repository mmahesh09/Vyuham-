"use client";

import { FileSpreadsheet, Upload } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { ACCEPTED } from "./types";

export function UploadDropzone({ onFile, compact = false }: { onFile: (file: File) => void; compact?: boolean }) {
  const [dragging, setDragging] = useState(false);

  return (
    <label
      htmlFor="dataset-file"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      className={cn(
        "flex cursor-pointer items-center justify-center gap-4 rounded-xl border border-dashed text-center transition-colors focus-within:border-highlight",
        compact ? "min-h-16 flex-row px-6" : "min-h-44 flex-col px-6 py-8",
        dragging ? "border-highlight bg-highlight/10" : "border-line-strong bg-surface/50 hover:border-primary hover:bg-surface",
      )}
    >
      {compact ? (
        <FileSpreadsheet className="size-5 text-highlight" strokeWidth={1.8} aria-hidden />
      ) : (
        <span className="flex size-12 items-center justify-center rounded-xl bg-line">
          <Upload className="size-6 text-highlight" strokeWidth={1.8} aria-hidden />
        </span>
      )}
      <span className="flex flex-col gap-1">
        <span className="text-[16px] font-semibold text-text">{compact ? "Choose another file" : "Drop an Excel or CSV file here"}</span>
        {!compact && <span className="text-sm text-muted">or click to choose one. Up to 10 MB; nothing is saved until you press Save.</span>}
      </span>
      <input
        id="dataset-file"
        type="file"
        accept={ACCEPTED.join(",")}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = ""; // allow re-selecting the same file
        }}
      />
    </label>
  );
}
