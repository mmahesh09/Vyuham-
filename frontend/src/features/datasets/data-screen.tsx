"use client";

import { AlertCircle, CheckCircle2, LoaderCircle, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/core";
import { useMe } from "@/features/auth/hooks";

import { ColumnSummary } from "./column-summary";
import { useUploadDataset, type Dataset } from "./api";
import { DataPreviewTable } from "./data-preview-table";
import { SavedDatasets } from "./saved-datasets";
import { UploadDropzone } from "./upload-dropzone";
import { useParsedFile } from "./use-parsed-file";

const nf = new Intl.NumberFormat("en-US");

export function DataScreen() {
  const { state, parse, selectSheet, reset } = useParsedFile();
  const upload = useUploadDataset();
  const { data: me } = useMe();
  const [saved, setSaved] = useState<Dataset | null>(null);
  const canSave = me?.role !== "viewer";

  function save() {
    if (state.status !== "done") return;
    upload.mutate(
      { file: state.file, sheet: state.result.activeSheet },
      {
        onSuccess: (dataset) => {
          setSaved(dataset);
          reset();
        },
      },
    );
  }

  function pick(file: File) {
    setSaved(null);
    upload.reset();
    parse(file);
  }

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-8 pt-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[38px] font-semibold tracking-[-0.03em]">Data</h1>
          <p className="text-[15px] text-white/55">Add a CSV or Excel file (up to 10 MB), check what we understood, then save it.</p>
        </div>
        {state.status === "done" && canSave && (
          <Button onClick={save} disabled={upload.isPending}>
            {upload.isPending ? (
              <>
                <LoaderCircle className="size-4 animate-spin" aria-hidden /> Saving…
              </>
            ) : (
              "Save dataset"
            )}
          </Button>
        )}
      </header>

      <UploadDropzone onFile={pick} compact={state.status === "done"} />

      <div aria-live="polite">
        {state.status === "parsing" && (
          <p className="flex items-center gap-2 text-[15px] text-white/70">
            <LoaderCircle className="size-4 animate-spin text-highlight" aria-hidden />
            Reading {state.fileName}…
          </p>
        )}
        {upload.isError && (
          <p role="alert" className="flex items-center gap-2 rounded-[12px] border border-accent/60 bg-accent/10 px-4 py-3 text-[15px] text-white">
            <AlertCircle className="size-4 shrink-0 text-accent" aria-hidden />
            {upload.error.message}
          </p>
        )}
        {saved && (
          <p role="status" className="flex items-center gap-2 rounded-[12px] border border-primary/50 bg-primary/10 px-4 py-3 text-[15px] text-white">
            <CheckCircle2 className="size-4 shrink-0 text-highlight" aria-hidden />
            Saved “{saved.name}” · {nf.format(saved.row_count)} rows, {saved.columns.length} columns.
          </p>
        )}
        {state.status === "error" && (
          <p role="alert" className="flex items-center gap-2 rounded-[12px] border border-accent/60 bg-accent/10 px-4 py-3 text-[15px] text-white">
            <AlertCircle className="size-4 shrink-0 text-accent" aria-hidden />
            {state.error}
          </p>
        )}
      </div>

      {state.status === "done" && (
        <>
          <section aria-labelledby="file-heading" className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
            <div className="flex flex-col gap-1">
              <h2 id="file-heading" className="text-xl font-semibold">
                {state.result.fileName}
              </h2>
              <p className="text-sm text-white/55">
                {nf.format(state.result.totalRows)} rows · {state.result.columns.length} columns
                {state.result.totalRows > state.result.rows.length && ` · previewing the first ${nf.format(state.result.rows.length)}`}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {state.result.sheets.length > 1 && (
                <label className="flex items-center gap-2 text-sm text-white/60">
                  Sheet
                  <select
                    value={state.result.activeSheet ?? ""}
                    onChange={(e) => selectSheet(e.target.value)}
                    className="min-h-11 rounded-[10px] border border-white/10 bg-black px-3 text-[15px] text-white"
                  >
                    {state.result.sheets.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                onClick={() => {
                  upload.reset();
                  reset();
                }}
                aria-label="Remove file"
                className="flex size-11 items-center justify-center rounded-full border border-white/10 text-white/60 hover:text-white"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </section>

          <section aria-labelledby="columns-heading" className="flex flex-col gap-4">
            <h2 id="columns-heading" className="text-lg font-semibold">
              What we found in each column
            </h2>
            <ColumnSummary columns={state.result.columns} />
          </section>

          <section aria-labelledby="preview-heading" className="flex flex-col gap-4">
            <h2 id="preview-heading" className="text-lg font-semibold">
              Preview
            </h2>
            <DataPreviewTable columns={state.result.columns} rows={state.result.rows} />
          </section>
        </>
      )}

      <SavedDatasets highlightId={saved?.id} />
    </div>
  );
}
