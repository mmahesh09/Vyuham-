"use client";

import { ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { ReportPage } from "../api";

type Props = {
  pages: ReportPage[];
  current: string;
  onSelect: (id: string) => void;
  /** Editors only: save a new page list. */
  onChange?: (pages: ReportPage[]) => void;
  /** How many visuals sit on each page (for the delete warning). */
  counts: Record<string, number>;
  saving?: boolean;
};

const newId = () => `p-${Math.random().toString(36).slice(2, 10)}`;

/** Report pages as tabs under the canvas, like Power BI. Editors can add, rename, move and delete them. */
export function PageTabs({ pages, current, onSelect, onChange, counts, saving }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirm, setConfirm] = useState<ReportPage | null>(null);
  const editable = !!onChange;
  if (pages.length < 2 && !editable) return null;

  const commitRename = () => {
    const name = draft.trim().slice(0, 60);
    if (renaming && name && onChange) onChange(pages.map((p) => (p.id === renaming ? { ...p, name } : p)));
    setRenaming(null);
  };
  const move = (id: string, by: -1 | 1) => {
    const i = pages.findIndex((p) => p.id === id);
    const j = i + by;
    if (j < 0 || j >= pages.length || !onChange) return;
    const next = [...pages];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = () => {
    if (!onChange || pages.length >= 20) return;
    const used = new Set(pages.map((p) => p.name));
    let n = pages.length + 1;
    while (used.has(`Page ${n}`)) n++;
    const page = { id: newId(), name: `Page ${n}` };
    onChange([...pages, page]);
    onSelect(page.id);
  };

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-t border-line pt-2" aria-busy={saving || undefined}>
      <div role="tablist" aria-label="Report pages" className="flex min-w-0 items-center gap-1">
        {pages.map((p, i) => {
          const active = p.id === current;
          if (renaming === p.id)
            return (
              <input
                key={p.id}
                autoFocus
                value={draft}
                maxLength={60}
                aria-label="Page name"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setRenaming(null);
                }}
                className="h-8 w-36 rounded-[4px] border border-highlight bg-surface px-2 text-[13px] text-text outline-none"
              />
            );
          return (
            <div
              key={p.id}
              className={cn(
                "group/tab relative flex h-8 shrink-0 items-center rounded-[4px] transition-colors",
                active ? "bg-surface text-text shadow-[inset_0_-2px_0_var(--color-highlight)]" : "text-muted hover:bg-surface/60 hover:text-text",
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => onSelect(p.id)}
                onDoubleClick={() => editable && (setRenaming(p.id), setDraft(p.name))}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight") onSelect(pages[(i + 1) % pages.length].id);
                  if (e.key === "ArrowLeft") onSelect(pages[(i - 1 + pages.length) % pages.length].id);
                }}
                className="h-full max-w-[200px] truncate px-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-highlight/60"
              >
                {p.name}
              </button>
              {editable && active && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`Options for ${p.name}`}
                    className="mr-1 flex size-6 items-center justify-center rounded-[3px] text-faint hover:bg-surface-2 hover:text-text"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-44">
                    <DropdownMenuItem onClick={() => (setRenaming(p.id), setDraft(p.name))}>
                      <Pencil /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={i === 0} onClick={() => move(p.id, -1)}>
                      <ChevronLeft /> Move left
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={i === pages.length - 1} onClick={() => move(p.id, 1)}>
                      <ChevronRight /> Move right
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" disabled={pages.length < 2} onClick={() => setConfirm(p)}>
                      <Trash2 /> Delete page
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
      </div>
      {editable && pages.length < 20 && (
        <button
          type="button"
          onClick={add}
          aria-label="Add a page"
          title="Add a page"
          className="flex size-8 shrink-0 items-center justify-center rounded-[4px] text-faint transition-colors hover:bg-surface hover:text-text"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{confirm?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm && counts[confirm.id]
                ? `Its ${counts[confirm.id]} visual${counts[confirm.id] === 1 ? "" : "s"} move to the first remaining page. Nothing is deleted.`
                : "The page is empty, so nothing else changes."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirm && onChange) {
                  const rest = pages.filter((p) => p.id !== confirm.id);
                  onChange(rest);
                  if (current === confirm.id) onSelect(rest[0].id);
                }
                setConfirm(null);
              }}
            >
              Delete page
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
