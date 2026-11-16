"use client";

import { Link2, RotateCcw, ShieldAlert, Unlink } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import { useErrorDetail, useErrors, useLinkTicket, useReopenError, useResolveError, useUnlinkTicket, type AuditEntry } from "./api";
import { Empty, MODULE_LABEL, Panel, ScopeBadge, StatusBadge, num, when } from "./ui";

export function AuditList({ entries }: { entries: AuditEntry[] }) {
  if (!entries.length) return <p className="text-sm text-muted">No changes recorded yet.</p>;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-col gap-1 py-2.5 text-[13px]">
          <span>
            <span className="font-medium">{e.action}</span> by {e.actor} <span className="text-faint">({e.role})</span> · <span className="text-faint">{when(e.at)}</span>
          </span>
          {e.note && <span className="text-muted">“{e.note}”</span>}
          {Object.keys(e.changes).length > 0 && (
            <details>
              <summary className="cursor-pointer text-faint hover:text-text">{Object.keys(e.changes).join(", ")}</summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-surface-2 p-2 text-[11px] whitespace-pre-wrap break-words">{JSON.stringify(e.changes, null, 2)}</pre>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

function ErrorActions({ id, status, ticket }: { id: string; status: string; ticket: number | null }) {
  const [note, setNote] = useState("");
  const [conversation, setConversation] = useState("");
  const resolve = useResolveError(id);
  const reopen = useReopenError(id);
  const link = useLinkTicket(id);
  const unlink = useUnlinkTicket(id);
  const err = resolve.error ?? reopen.error ?? link.error ?? unlink.error;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line p-3">
      {status === "open" ? (
        <form className="flex flex-col gap-2" onSubmit={(e) => (e.preventDefault(), resolve.mutate(note.trim(), { onSuccess: () => setNote("") }))}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={2} placeholder="How was it resolved? (e.g. fixed in 1.4.1)" aria-label="Resolution note" />
          <Button type="submit" size="sm" className="self-start" disabled={note.trim().length < 3 || resolve.isPending}>Mark as resolved</Button>
        </form>
      ) : (
        <Button size="sm" variant="outline" className="self-start" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
          <RotateCcw /> Reopen
        </Button>
      )}
      {ticket ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          Linked to Chatwoot ticket <Badge variant="primary-light">#{ticket}</Badge>
          <Button size="sm" variant="ghost" onClick={() => unlink.mutate()} disabled={unlink.isPending}><Unlink /> Unlink</Button>
        </div>
      ) : (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => (e.preventDefault(), link.mutate(Number(conversation), { onSuccess: () => setConversation("") }))}>
          <Input value={conversation} onChange={(e) => setConversation(e.target.value.replace(/\D/g, "").slice(0, 9))} placeholder="Chatwoot ticket #" aria-label="Chatwoot ticket number" className="h-8 w-40" inputMode="numeric" />
          <Button type="submit" size="sm" variant="outline" disabled={!conversation || link.isPending}><Link2 /> Link ticket</Button>
          <span className="text-[12px] text-faint">Must be a conversation from this workspace.</span>
        </form>
      )}
      {err && <p className="text-[13px] text-accent">{err.message}</p>}
    </div>
  );
}

function ErrorDetailSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: d, isPending, isError, error } = useErrorDetail(id);
  return (
    <Sheet open={Boolean(id)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex flex-col gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b border-line">
          <SheetTitle>Error details</SheetTitle>
          <SheetDescription>Diagnostics were redacted when the error was recorded. Customers appear as workspace names and pseudonymous user references.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 p-4">
          {isPending && <p className="text-sm text-muted">Loading…</p>}
          {isError && <p className="text-sm text-accent">{error.message}</p>}
          {d && (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={d.status} />
                  {d.regressed_at && <Badge variant="destructive-light"><ShieldAlert className="size-3" aria-hidden /> Regressed {when(d.regressed_at)}</Badge>}
                  <Badge variant="secondary">{MODULE_LABEL[d.module] ?? d.module}</Badge>
                  <Badge variant="secondary">{d.category}</Badge>
                </div>
                <p className="font-mono text-[13px] whitespace-pre-wrap break-words">{d.message}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                  <dt className="text-faint">Workspace</dt><dd>{d.workspace ?? d.workspace_id}</dd>
                  <dt className="text-faint">Occurrences</dt><dd className="tabular-nums">{num(d.count)}</dd>
                  <dt className="text-faint">First / last seen</dt><dd>{when(d.first_seen)} · {when(d.last_seen)}</dd>
                  <dt className="text-faint">Fingerprint</dt><dd className="truncate font-mono text-[12px]" title={d.fingerprint}>{d.fingerprint.slice(0, 16)}…</dd>
                  {d.resolution_note && (<><dt className="text-faint">Resolution</dt><dd>{d.resolution_note}</dd></>)}
                </dl>
              </div>

              <ErrorActions id={d.id} status={d.status} ticket={d.chatwoot_conversation_id} />

              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Recent occurrences</h3>
                <ul className="flex flex-col gap-2">
                  {d.events.map((e) => (
                    <li key={e.id} className="rounded-xl border border-line p-3 text-[13px]">
                      <p className="text-faint">{when(e.at)} · version {e.app_version ?? "unknown"} · {e.user}</p>
                      <p className="mt-1 font-mono text-[12px] whitespace-pre-wrap break-words">{e.message}</p>
                      {Object.keys(e.details ?? {}).length > 0 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-faint hover:text-text">Sanitized diagnostics</summary>
                          <pre className="mt-1 max-h-56 overflow-auto rounded-lg bg-surface-2 p-2 text-[11px] whitespace-pre-wrap break-words">{JSON.stringify(e.details, null, 2)}</pre>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">AI answers for this error</h3>
                {d.ai_sessions.length ? (
                  <ul className="flex flex-col gap-2">
                    {d.ai_sessions.map((s) => (
                      <li key={s.id} className="rounded-xl border border-line p-3 text-[13px]">
                        <p className="text-faint">{when(s.created_at)} · confidence {s.confidence ?? "–"} · {s.grounded ? "cited verified articles" : "no verified article"}</p>
                        <p className="mt-1">{s.summary ?? s.status}</p>
                        {s.feedback && <Badge variant={s.feedback === "resolved" ? "success-light" : "warning-light"} className="mt-1">{s.feedback === "resolved" ? "Customer: solved" : "Customer: not solved"}</Badge>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">The assistant hasn&apos;t been asked about this error.</p>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Related knowledge</h3>
                <p className="text-[12px] text-faint">Global articles and this workspace&apos;s own, matched by fingerprint or category.</p>
                {d.articles.length ? (
                  <ul className="flex flex-col gap-1.5">
                    {d.articles.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                        <StatusBadge status={a.status} /> <ScopeBadge scope={a.scope} /> {a.title}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">None yet. Consider writing an article in the Knowledge tab.</p>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">History</h3>
                <AuditList entries={d.audit} />
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function ErrorsTab({ fingerprint, clearFingerprint }: { fingerprint?: string; clearFingerprint: () => void }) {
  const [status, setStatus] = useState("open");
  const [module, setModule] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { data, isPending, isError, error } = useErrors({ status: fingerprint ? "" : status, module, q: q.trim(), fingerprint });

  return (
    <Panel
      title="Errors"
      description="One row per error group in each workspace."
      action={
        <div className="flex flex-wrap items-center gap-2">
          {fingerprint ? (
            <Button size="sm" variant="outline" onClick={clearFingerprint}>Showing one fingerprint · clear</Button>
          ) : (
            <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <NativeSelectOption value="open">Unresolved</NativeSelectOption>
              <NativeSelectOption value="resolved">Resolved</NativeSelectOption>
              <NativeSelectOption value="">All</NativeSelectOption>
            </NativeSelect>
          )}
          <NativeSelect value={module} onChange={(e) => setModule(e.target.value)} aria-label="Module">
            <NativeSelectOption value="">All modules</NativeSelectOption>
            {Object.entries(MODULE_LABEL).map(([v, l]) => <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>)}
          </NativeSelect>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages" aria-label="Search errors" className="h-9 w-48" />
        </div>
      }
    >
      {isPending ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : isError ? (
        <p className="text-sm text-accent">{error.message}</p>
      ) : !data.errors.length ? (
        <Empty>No errors match.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Error</TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead>Module</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ticket</TableHead>
                <TableHead>Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.errors.map((e) => (
                <TableRow key={e.id} className="cursor-pointer" onClick={() => setOpen(e.id)}>
                  <TableCell className="max-w-[380px]"><span className="block truncate font-mono text-[12px]" title={e.message}>{e.message}</span><span className="text-[12px] text-faint">{e.category}</span></TableCell>
                  <TableCell className="max-w-[160px] truncate">{e.workspace ?? e.workspace_id}</TableCell>
                  <TableCell>{MODULE_LABEL[e.module] ?? e.module}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(e.count)}</TableCell>
                  <TableCell><StatusBadge status={e.status} />{e.regressed_at && e.status === "open" ? <span className="ml-1 text-[11px] text-accent">regressed</span> : null}</TableCell>
                  <TableCell>{e.chatwoot_conversation_id ? `#${e.chatwoot_conversation_id}` : "–"}</TableCell>
                  <TableCell className="whitespace-nowrap text-[13px] text-muted">{when(e.last_seen)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-[12px] text-faint">{num(data.total)} total{data.total > data.errors.length ? `, showing ${data.errors.length}` : ""}</p>
        </div>
      )}
      <ErrorDetailSheet id={open} onClose={() => setOpen(null)} />
    </Panel>
  );
}
