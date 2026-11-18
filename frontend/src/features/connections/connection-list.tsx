"use client";

import { formatDistanceToNow } from "date-fns";
import { Database, Pencil, Plus, Trash2 } from "lucide-react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { KIND_LABEL, useConnections, useDeleteConnection, type Connection } from "./api";
import { EditConnectionDialog } from "./edit-connection-dialog";

/** The workspace's database connections, with "add tables", edit and delete. Hidden until there is one, and from viewers. */
export function ConnectionList({ canEdit, onAddTables }: { canEdit: boolean; onAddTables: (connectionId: string) => void }) {
  const { data } = useConnections(canEdit);
  const remove = useDeleteConnection();
  const [editing, setEditing] = useState<Connection | null>(null);
  if (!canEdit || !data?.length) return null;

  return (
    <section aria-labelledby="connections-heading" className="flex flex-col gap-3">
      <h2 id="connections-heading" className="type-section flex items-baseline gap-2">
        Connected databases <span className="text-[13px] font-normal text-faint">{data.length}</span>
      </h2>
      <ul className="grid gap-3 md:grid-cols-2">
        {data.map((c) => (
          <li key={c.id} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-lg",
                  c.kind === "postgres" ? "bg-sky-500/15 text-sky-400" : "bg-amber-500/15 text-amber-400",
                )}
              >
                <Database className="size-[18px]" aria-hidden />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="truncate font-medium text-text">{c.name}</p>
                <p className="truncate text-[12.5px] text-faint">
                  {KIND_LABEL[c.kind]} · {c.host}/{c.database}
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px]",
                  c.status === "ok" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
                )}
              >
                <span className={cn("size-1.5 rounded-full", c.status === "ok" ? "bg-success" : "bg-destructive")} aria-hidden />
                {c.status === "ok" ? "Connected" : "Problem"}
              </span>
            </div>
            {c.status === "error" && c.last_error && <p className="text-[13px] text-accent">{c.last_error}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <span className="text-[12.5px] text-faint">
                {c.dataset_count} {c.dataset_count === 1 ? "dataset" : "datasets"}
                {c.last_checked_at && ` · checked ${formatDistanceToNow(new Date(c.last_checked_at), { addSuffix: true })}`}
              </span>
              {canEdit && (
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => onAddTables(c.id)}>
                    <Plus aria-hidden /> Add tables
                  </Button>
                  <Button variant={c.status === "error" ? "outline" : "ghost"} size="sm" onClick={() => setEditing(c)}>
                    <Pencil aria-hidden /> {c.status === "error" ? "Fix connection" : "Edit"}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Remove ${c.name}`} />}>
                      <Trash2 />
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove “{c.name}”?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Its {c.dataset_count} {c.dataset_count === 1 ? "dataset stays" : "datasets stay"} with the data from the last refresh, but
                          stop updating. The saved password is deleted.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep it</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(c.id)}>
                          Remove connection
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {editing && <EditConnectionDialog connection={editing} open onOpenChange={(open) => !open && setEditing(null)} />}
    </section>
  );
}
