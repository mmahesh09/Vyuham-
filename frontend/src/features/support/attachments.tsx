"use client";

import { FileText, ImageIcon, Loader2, Paperclip, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { ATTACHMENT_ACCEPT, attachmentUrl, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, uploadAttachment, type Attachment } from "./api";

type Item = {
  key: string;
  file: File;
  preview: string | null;
  status: "uploading" | "done" | "error";
  attachment?: Attachment;
  error?: string;
};

const ALLOWED = new Set(ATTACHMENT_ACCEPT.split(","));
const extOf = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "");
const isImage = (type: string) => /^image\/(png|jpeg|gif|webp)$/.test(type);

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Files on a request or reply. Each file uploads as soon as it's added, so sending the message
 * only has to pass the ids. Paste a screenshot straight into the text box with `onPaste`.
 */
export function useAttachments() {
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Free the image previews when the form goes away.
  useEffect(() => () => itemsRef.current.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)), []);

  const start = useCallback((item: Item) => {
    uploadAttachment(item.file)
      .then((attachment) => setItems((xs) => xs.map((x) => (x.key === item.key ? { ...x, status: "done", attachment } : x))))
      .catch((e: unknown) =>
        setItems((xs) =>
          xs.map((x) => (x.key === item.key ? { ...x, status: "error", error: e instanceof Error ? e.message : "Upload failed." } : x)),
        ),
      );
  }, []);

  const add = useCallback(
    (files: Iterable<File>) => {
      const list = [...files];
      if (!list.length) return;
      const room = MAX_ATTACHMENTS - itemsRef.current.length;
      const problems: string[] = [];
      const fresh: Item[] = [];
      for (const raw of list) {
        // Pasted screenshots arrive as "image.png" or with no name at all.
        const file = raw.name ? raw : new File([raw], `screenshot-${Date.now()}.png`, { type: raw.type });
        if (fresh.length >= room) {
          problems.push(`You can add up to ${MAX_ATTACHMENTS} files.`);
          break;
        }
        if (!ALLOWED.has(extOf(file.name))) problems.push(`${file.name}: attach images, PDFs, text, CSV or Excel files.`);
        else if (file.size > MAX_ATTACHMENT_BYTES) problems.push(`${file.name} is over 10 MB.`);
        else if (file.size === 0) problems.push(`${file.name} is empty.`);
        else
          fresh.push({
            key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
            file,
            preview: isImage(file.type) ? URL.createObjectURL(file) : null,
            status: "uploading",
          });
      }
      setNotice(problems[0] ?? null);
      if (!fresh.length) return;
      setItems((xs) => [...xs, ...fresh]);
      fresh.forEach(start);
    },
    [start],
  );

  const remove = useCallback((key: string) => {
    setItems((xs) => {
      const gone = xs.find((x) => x.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return xs.filter((x) => x.key !== key);
    });
  }, []);

  const retry = useCallback(
    (key: string) => {
      const item = itemsRef.current.find((x) => x.key === key);
      if (!item) return;
      const again = { ...item, status: "uploading" as const, error: undefined };
      setItems((xs) => xs.map((x) => (x.key === key ? again : x)));
      start(again);
    },
    [start],
  );

  const reset = useCallback(() => {
    itemsRef.current.forEach((i) => i.preview && URL.revokeObjectURL(i.preview));
    setItems([]);
    setNotice(null);
  }, []);

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = [...e.clipboardData.files];
      if (files.length) {
        e.preventDefault();
        add(files);
      }
    },
    [add],
  );

  return {
    items,
    notice,
    add,
    remove,
    retry,
    reset,
    onPaste,
    ids: items.flatMap((i) => (i.attachment ? [i.attachment.id] : [])),
    uploading: items.some((i) => i.status === "uploading"),
    failed: items.some((i) => i.status === "error"),
  };
}

export type AttachmentsState = ReturnType<typeof useAttachments>;

/** A drop zone and the chips for the files added so far. */
export function AttachmentPicker({ state, compact = false }: { state: AttachmentsState; compact?: boolean }) {
  const inputId = useId();
  const hintId = useId();
  const [over, setOver] = useState(false);
  const full = state.items.length >= MAX_ATTACHMENTS;

  return (
    <div className="flex flex-col gap-2.5">
      {!full && (
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            state.add(e.dataTransfer.files);
          }}
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-xl border border-dashed text-[13.5px] text-muted transition-colors focus-within:border-highlight focus-within:ring-[3px] focus-within:ring-highlight/20 hover:border-line-strong hover:text-text",
            compact ? "w-fit px-3 py-2" : "px-4 py-3.5",
            over ? "border-highlight bg-highlight/5 text-text" : "border-line",
          )}
        >
          <Paperclip className="size-4 shrink-0 text-faint" aria-hidden />
          <span>
            {compact ? (
              "Attach files"
            ) : (
              <>
                <span className="font-medium text-text">Add screenshots or files</span>
                <span id={hintId} className="block text-[12.5px] text-faint">
                  Drop them here, browse, or paste a screenshot into the description. Up to {MAX_ATTACHMENTS} files, 10 MB each.
                </span>
              </>
            )}
          </span>
          <input
            id={inputId}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="sr-only"
            aria-describedby={compact ? undefined : hintId}
            onChange={(e) => {
              state.add(e.target.files ?? []);
              e.target.value = "";
            }}
          />
        </label>
      )}

      {state.notice && (
        <p role="alert" className="text-[13px] text-destructive">
          {state.notice}
        </p>
      )}

      {state.items.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Attached files">
          {state.items.map((i) => (
            <li
              key={i.key}
              className={cn(
                "flex max-w-full items-center gap-2.5 rounded-xl border bg-surface py-1.5 pl-1.5 pr-2 text-[13px]",
                i.status === "error" ? "border-destructive/50" : "border-line",
              )}
            >
              {i.preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
                <img src={i.preview} alt="" className="size-9 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-highlight">
                  <FileText className="size-4" aria-hidden />
                </span>
              )}
              <span className="flex min-w-0 flex-col">
                <span className="max-w-[200px] truncate font-medium text-text">{i.file.name}</span>
                <span className={cn("text-[12px]", i.status === "error" ? "text-destructive" : "text-faint")}>
                  {i.status === "uploading" ? "Uploading…" : i.status === "error" ? i.error : formatBytes(i.file.size)}
                </span>
              </span>
              {i.status === "uploading" && <Loader2 className="size-4 shrink-0 animate-spin text-faint" aria-label="Uploading" />}
              {i.status === "error" && (
                <button
                  type="button"
                  onClick={() => state.retry(i.key)}
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-faint hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-highlight"
                  aria-label={`Try uploading ${i.file.name} again`}
                >
                  <RotateCw className="size-3.5" aria-hidden />
                </button>
              )}
              <button
                type="button"
                onClick={() => state.remove(i.key)}
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-faint hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-highlight"
                aria-label={`Remove ${i.file.name}`}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Files on a sent message: image thumbnails that open full size, other files as download chips. */
export function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  if (!attachments?.length) return null;
  const images = attachments.filter((a) => isImage(a.content_type));
  const files = attachments.filter((a) => !isImage(a.content_type));
  return (
    <div className="mt-3 flex flex-col gap-2">
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {images.map((a) => (
            <li key={a.id}>
              <a
                href={attachmentUrl(a.id)}
                target="_blank"
                rel="noopener"
                className="block overflow-hidden rounded-xl border border-line transition-colors hover:border-highlight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight"
                title={a.filename}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API image */}
                <img src={attachmentUrl(a.id)} alt={a.filename} loading="lazy" className="h-28 w-auto max-w-[240px] object-cover" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((a) => (
            <li key={a.id}>
              <a
                href={attachmentUrl(a.id)}
                download={a.filename}
                className="flex items-center gap-2 rounded-lg border border-line bg-bg/50 px-3 py-2 text-[13px] text-text transition-colors hover:border-highlight focus-visible:outline-2 focus-visible:outline-highlight"
              >
                {a.content_type.startsWith("image/") ? (
                  <ImageIcon className="size-4 text-faint" aria-hidden />
                ) : (
                  <FileText className="size-4 text-faint" aria-hidden />
                )}
                <span className="max-w-[220px] truncate">{a.filename}</span>
                <span className="text-faint">{formatBytes(a.size)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
