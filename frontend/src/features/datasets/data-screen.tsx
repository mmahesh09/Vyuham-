"use client";

import { Database, LoaderCircle, X } from "lucide-react";
import { useState } from "react";

import { PageContainer } from "@/components/app/page-container";
import { InlineAlert } from "@/components/app/inline-alert";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/core";
import { NativeSelect } from "@/components/ui/native-select";
import { useMe } from "@/features/auth/hooks";
import { ConnectDatabaseDialog } from "@/features/connections/connect-database-dialog";
import { ConnectionList } from "@/features/connections/connection-list";
import { RefreshHooks } from "@/features/connections/refresh-hooks";

import { AddDataOptions } from "./add-data-options";
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
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [otherError, setOtherError] = useState<string | null>(null);
  const canSave = me?.role !== "viewer";

  function openConnect(id: string | null = null) {
    setConnectionId(id);
    setConnectOpen(true);
  }

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
    <PageContainer>
      <PageHeader
        title="Data"
        description="Bring data in from files, links and databases, or build new datasets from the ones you have."
        actions={
          <>
            {canSave && state.status !== "done" && (
              <Button variant="ghost" onClick={() => openConnect()}>
                <Database className="size-4" aria-hidden /> Connect a database
              </Button>
            )}
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
          </>
        }
      />

      <UploadDropzone onFile={pick} compact={state.status === "done"} />
      {canSave && state.status !== "done" && (
        <AddDataOptions onSaved={(d) => (setOtherError(null), setSaved(d))} onError={setOtherError} />
      )}

      <div aria-live="polite" className="empty:hidden">
        {state.status === "parsing" && (
          <p className="flex items-center gap-2 text-[15px] text-muted">
            <LoaderCircle className="size-4 animate-spin text-highlight" aria-hidden />
            Reading {state.fileName}…
          </p>
        )}
        {otherError && <InlineAlert>{otherError}</InlineAlert>}
        {upload.isError && (
          <InlineAlert>{upload.error.message}</InlineAlert>
        )}
        {saved && (
          <InlineAlert tone="info">
            Saved “{saved.name}”: {nf.format(saved.row_count)} rows, {saved.columns.length} columns.
          </InlineAlert>
        )}
        {state.status === "error" && (
          <InlineAlert>{state.error}</InlineAlert>
        )}
      </div>

      {state.status === "done" && (
        <>
          <section aria-labelledby="file-heading" className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
            <div className="flex flex-col gap-1">
              <h2 id="file-heading" className="type-section">
                {state.result.fileName}
              </h2>
              <p className="text-sm text-muted">
                {nf.format(state.result.totalRows)} rows · {state.result.columns.length} columns
                {state.result.totalRows > state.result.rows.length && ` · previewing the first ${nf.format(state.result.rows.length)}`}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {state.result.sheets.length > 1 && (
                <label className="flex items-center gap-2 text-sm text-muted">
                  Sheet
                  <NativeSelect value={state.result.activeSheet ?? ""} onChange={(e) => selectSheet(e.target.value)}>
                    {state.result.sheets.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </NativeSelect>
                </label>
              )}
              <button
                type="button"
                onClick={() => {
                  upload.reset();
                  reset();
                }}
                aria-label="Remove file"
                className="flex size-10 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:border-line-strong hover:text-text"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </section>

          <section aria-labelledby="columns-heading" className="flex flex-col gap-4">
            <h2 id="columns-heading" className="type-section">
              What we found in each column
            </h2>
            <ColumnSummary columns={state.result.columns} />
          </section>

          <section aria-labelledby="preview-heading" className="flex flex-col gap-4">
            <h2 id="preview-heading" className="type-section">
              Preview
            </h2>
            <DataPreviewTable columns={state.result.columns} rows={state.result.rows} />
          </section>
        </>
      )}

      <ConnectionList canEdit={canSave} onAddTables={(id) => openConnect(id)} />
      <RefreshHooks canEdit={canSave} />
      <SavedDatasets highlightId={saved?.id} />
      {canSave && <ConnectDatabaseDialog open={connectOpen} onOpenChange={setConnectOpen} connectionId={connectionId} />}
    </PageContainer>
  );
}
