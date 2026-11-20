"use client";

import { formatDistanceToNow } from "date-fns";
import { Check, Copy, Plus, Trash2, Webhook } from "lucide-react";
import { useState } from "react";

import { InlineAlert } from "@/components/app/inline-alert";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDatasets, type Dataset } from "@/features/datasets/api";
import { cn } from "@/lib/utils";

import { useCreateRefreshHook, useRefreshHooks, useRevokeRefreshHook, type CreatedRefreshHook } from "./api";

const TOOLS = ["Airflow", "Airbyte", "Kubeflow", "cron"] as const;
type Tool = (typeof TOOLS)[number];

/** How to call the hook from each tool. The URL is a secret, so every snippet keeps it out of plain sight where it can. */
function snippet(tool: Tool, url: string): string {
  switch (tool) {
    case "Airflow":
      return `# Last task of your DAG. Keep the URL in an Airflow Variable or secret backend.
try:
    from airflow.providers.standard.operators.bash import BashOperator  # Airflow 3
except ImportError:
    from airflow.operators.bash import BashOperator  # Airflow 2

refresh_vyuham = BashOperator(
    task_id="refresh_vyuham",
    bash_command="curl -fsS -X POST '${url}'",
)

load >> transform >> refresh_vyuham`;
    case "Airbyte":
      return `Airbyte → Settings → Notifications → Webhook
Paste this URL under "Successful syncs":

${url}`;
    case "Kubeflow":
      return `from kfp import dsl

@dsl.container_component
def refresh_vyuham():
    return dsl.ContainerSpec(
        image="curlimages/curl:8.10.1",
        command=["curl", "-fsS", "-X", "POST", "${url}"],
    )

# In your pipeline, run it after the step that writes the data:
# refresh_vyuham().after(load_task)`;
    case "cron":
      return `# Every hour, at minute 5
5 * * * * curl -fsS -X POST '${url}'`;
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : label}
    </Button>
  );
}

/** Shown once after creating a hook: the full URL and how to call it from each tool. */
function CreatedHook({ hook }: { hook: CreatedRefreshHook }) {
  const [tool, setTool] = useState<Tool>("Airflow");
  const url = `${window.location.origin}/api${hook.path}`;
  return (
    <div className="flex flex-col gap-4">
      <InlineAlert tone="info">Copy this URL now. For your security it won&apos;t be shown again.</InlineAlert>
      <div className="flex flex-col gap-2">
        <code className="block break-all rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-[12.5px] text-text">{url}</code>
        <div>
          <CopyButton text={url} label="Copy URL" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div role="tablist" aria-label="Call it from" className="flex flex-wrap gap-1">
          {TOOLS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tool === t}
              onClick={() => setTool(t)}
              className={cn(
                "min-h-9 rounded-md px-3 text-[13px] transition-colors",
                tool === t ? "bg-surface-2 text-text" : "text-muted hover:text-text",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <pre className="max-h-[32dvh] overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-text">
          {snippet(tool, url)}
        </pre>
        <div>
          <CopyButton text={snippet(tool, url)} label={`Copy ${tool} snippet`} />
        </div>
      </div>
    </div>
  );
}

function CreateHookDialog({ open, onOpenChange, connected }: { open: boolean; onOpenChange: (open: boolean) => void; connected: Dataset[] }) {
  const create = useCreateRefreshHook();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const created = create.data;

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setName("");
      setPicked([]);
      create.reset();
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{created ? `“${created.name}” is ready` : "New refresh hook"}</DialogTitle>
          <DialogDescription>
            {created
              ? "Call this URL when your pipeline finishes, and the datasets below refresh straight away."
              : "A secret URL your pipeline calls when new data lands, so dashboards update right away instead of on the hour."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <CreatedHook hook={created} />
        ) : (
          <form
            id="new-hook"
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate({ name: name.trim(), dataset_ids: picked });
            }}
          >
            <label className="flex flex-col gap-1.5 text-[13px] font-medium text-text">
              Name
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nightly Airflow DAG" maxLength={120} required />
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-[13px] font-medium text-text">Datasets to refresh</legend>
              <ul className="max-h-[34dvh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
                {connected.map((d) => {
                  const on = picked.includes(d.id);
                  return (
                    <li key={d.id} className={cn("px-3 py-1", on && "bg-primary/[0.06]")}>
                      <label className="flex min-h-10 cursor-pointer items-center gap-3">
                        <Checkbox
                          checked={on}
                          onCheckedChange={(v) => setPicked((p) => (v ? [...p, d.id] : p.filter((x) => x !== d.id)))}
                          aria-label={`Refresh ${d.name}`}
                        />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-[14px] text-text">{d.name}</span>
                          {d.source_table && <span className="truncate text-[12px] text-faint">{d.source_table}</span>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
            {create.isError && <InlineAlert>{create.error.message}</InlineAlert>}
          </form>
        )}

        <DialogFooter>
          {created ? (
            <Button onClick={() => close(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" form="new-hook" disabled={!name.trim() || picked.length === 0 || create.isPending}>
                Create hook
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Refresh hooks: let Airflow, Airbyte, Kubeflow or cron refresh connected datasets when new data lands.
 * Editors only, and only once there is connected data to refresh.
 */
export function RefreshHooks({ canEdit }: { canEdit: boolean }) {
  const { data: hooks } = useRefreshHooks(canEdit);
  const { data: datasets } = useDatasets();
  const revoke = useRevokeRefreshHook();
  const [creating, setCreating] = useState(false);

  const connected = (datasets ?? []).filter((d) => d.connection_id);
  if (!canEdit || connected.length === 0) return null;
  const names = new Map(connected.map((d) => [d.id, d.name]));
  const active = (hooks ?? []).filter((h) => !h.revoked_at);

  return (
    <section aria-labelledby="hooks-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="hooks-heading" className="type-section">
            Refresh from your pipeline
          </h2>
          <p className="max-w-[62ch] text-[13.5px] text-muted">
            When Airflow, Airbyte, Kubeflow or a cron job finishes loading data, it can call a refresh hook so your dashboards update at once.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <Plus aria-hidden /> New refresh hook
        </Button>
      </div>

      {active.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {active.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Webhook className="size-[18px] shrink-0 text-faint" aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="truncate text-[14px] font-medium text-text">
                  {h.name} <span className="font-mono text-[12px] font-normal text-faint">…{h.token_hint}</span>
                </p>
                <p className="truncate text-[12.5px] text-faint">
                  {h.dataset_ids.map((id) => names.get(id) ?? "Removed dataset").join(", ")}
                  {" · "}
                  {h.last_called_at ? `last called ${formatDistanceToNow(new Date(h.last_called_at), { addSuffix: true })}` : "not called yet"}
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Revoke ${h.name}`} />}>
                  <Trash2 />
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Revoke “{h.name}”?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Its URL stops working at once. Anything still calling it gets no error, but nothing refreshes.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep it</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" disabled={revoke.isPending} onClick={() => revoke.mutate(h.id)}>
                      Revoke hook
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          ))}
        </ul>
      )}

      <CreateHookDialog open={creating} onOpenChange={setCreating} connected={connected} />
    </section>
  );
}
