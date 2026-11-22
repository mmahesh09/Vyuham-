"use client";

import { Braces, Code2, Link2, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import { useUploadDataset, type Dataset, type Layer } from "./api";
import { LAYERS, useImportUrl } from "./platform-api";
import { ACCEPTED_DIRECT, MAX_FILE_BYTES } from "./types";

const card =
  "group flex min-w-0 items-start gap-3 rounded-[8px] border border-line bg-surface p-3.5 text-left transition-colors hover:border-line-strong disabled:opacity-60";

function ImportLinkDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: (d: Dataset) => void }) {
  const imp = useImportUrl();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [layer, setLayer] = useState<Layer | "">("bronze");
  const [refresh, setRefresh] = useState<"manual" | "hourly" | "daily">("manual");

  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), !o && imp.reset())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from a link</DialogTitle>
          <DialogDescription>
            A public CSV, JSON, Excel or Parquet file, or a Google Sheet shared as “anyone with the link”. Up to 10 MB.
          </DialogDescription>
        </DialogHeader>
        <form
          id="import-link"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            imp.mutate(
              { url: url.trim(), name: name.trim() || undefined, layer: layer || null, refresh },
              { onSuccess: (d) => (onDone(d), onOpenChange(false), setUrl(""), setName("")) },
            );
          }}
        >
          <label className="flex flex-col gap-1.5 text-[13px] text-muted">
            Link
            <Input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" autoFocus />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] text-muted">
            Name <span className="text-faint">(optional)</span>
            <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder="Taken from the file if empty" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-[13px] text-muted">
              Layer
              <NativeSelect value={layer} onChange={(e) => setLayer(e.target.value as Layer | "")}>
                <option value="">No layer</option>
                {LAYERS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] text-muted">
              Download again
              <NativeSelect value={refresh} onChange={(e) => setRefresh(e.target.value as "manual" | "hourly" | "daily")}>
                <option value="manual">Only when I refresh</option>
                <option value="daily">Every day</option>
                <option value="hourly">Every hour</option>
              </NativeSelect>
            </label>
          </div>
          {imp.isError && (
            <p role="alert" className="text-[13px] text-accent">
              {imp.error.message}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="import-link" disabled={imp.isPending || !url.trim()}>
            {imp.isPending ? (
              <>
                <LoaderCircle className="animate-spin" /> Importing…
              </>
            ) : (
              "Import"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The other ways in, beside the CSV/Excel drop zone: a link, a JSON or Parquet file (sent straight
 * to the server, which types it), and a SQL query over data already here.
 */
export function AddDataOptions({ onSaved, onError }: { onSaved: (d: Dataset) => void; onError: (message: string) => void }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const upload = useUploadDataset();
  const fileRef = useRef<HTMLInputElement>(null);

  const sendFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return onError("This file is over 10 MB, the beta limit.");
    upload.mutate({ file }, { onSuccess: onSaved, onError: (e) => onError(e.message) });
  };

  return (
    <section aria-label="More ways to add data" className="grid gap-3 sm:grid-cols-3">
      <button type="button" className={card} onClick={() => setLinkOpen(true)}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-highlight">
          <Link2 className="size-4" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[14px] font-medium text-text">Import from a link</span>
          <span className="text-[12.5px] text-faint">Google Sheets or a public file, refreshed on a schedule</span>
        </span>
      </button>
      <button type="button" className={card} onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-highlight">
          {upload.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Braces className="size-4" aria-hidden />}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[14px] font-medium text-text">{upload.isPending ? "Uploading…" : "Upload JSON or Parquet"}</span>
          <span className="text-[12.5px] text-faint">Arrays of objects, JSON Lines or Parquet files</span>
        </span>
      </button>
      <Link href="/sql" className={card}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-highlight">
          <Code2 className="size-4" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[14px] font-medium text-text">Build from a query</span>
          <span className="text-[12.5px] text-faint">Join and clean data in SQL Lab, then save it as a dataset</span>
        </span>
      </Link>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_DIRECT.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          sendFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <ImportLinkDialog open={linkOpen} onOpenChange={setLinkOpen} onDone={onSaved} />
    </section>
  );
}
