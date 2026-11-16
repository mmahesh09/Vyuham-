"use client";

import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, BookOpen, History, MessagesSquare, Plus, Send, ShieldCheck, Sparkles } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useSupportConfig, useSupportConversations } from "@/features/support/api";
import { openSupportChat, previousAppPage } from "@/features/support/widget";
import { recentApiErrors } from "@/lib/api/recent-errors";

import { AnswerCard } from "./answer-card";
import { useArticle, useAsk, useModuleContext, useThread, useThreads, type AssistantModule, type AssistantSession } from "./api";
import { MODULE_LABEL, PICKABLE, SUGGESTIONS, errorsForModule, moduleFromPath } from "./module-context";
import { useAssistantStore } from "./store";

function ArticleDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isPending, isError } = useArticle(id);
  return (
    <Dialog open={Boolean(id)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{data?.title ?? "Help article"}</DialogTitle>
          <DialogDescription>
            {data ? `${data.scope === "global" ? "Vyuham help" : "Your workspace"} · ${data.verified ? "Tested by our team" : "Not verified"} · ref ${data.id.slice(0, 8)}` : " "}
          </DialogDescription>
        </DialogHeader>
        {isPending && <p className="text-sm text-muted">Loading…</p>}
        {isError && <p className="text-sm text-accent">This article isn&apos;t available.</p>}
        {data && (
          <div className="flex flex-col gap-3 text-sm">
            {[["Symptoms", data.symptoms], ["Cause", data.root_cause], ["How to fix it", data.resolution]].map(([label, text]) => (
              <div key={label} className="flex flex-col gap-1">
                <p className="text-[12px] font-medium uppercase tracking-wide text-faint">{label}</p>
                <p className="whitespace-pre-wrap break-words">{text}</p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** What the customer may choose to share: server diagnostics for the module plus recent errors in this tab. */
function useDiagnostics(module: AssistantModule, dashboardId: string | undefined, wanted: boolean) {
  const recent = useMemo(() => errorsForModule(recentApiErrors(), module), [module]);
  const server = useModuleContext(module, dashboardId, wanted);
  const serverData = server.data && Object.keys(server.data).length > 1 ? server.data : null;
  const context = wanted ? { ...(serverData ?? {}), ...(recent.length ? { recent_errors: recent.slice(0, 5) } : {}) } : null;
  const latest = recent[0];
  const error = latest ? { module, message: latest.message, error_type: `HTTP ${latest.status}`, http_status: latest.status, details: latest.sql ? { sql: latest.sql, path: latest.path } : { path: latest.path } } : undefined;
  return { recent, context, error, loading: server.isFetching, hasAnything: recent.length > 0 || module === "dashboard" || module === "automations" || module === "reports" };
}

function Composer({ module, dashboardId, threadId, onAsked }: { module: AssistantModule; dashboardId?: string; threadId?: string; onAsked: (s: AssistantSession) => void }) {
  const draft = useAssistantStore((s) => s.draft);
  const [question, setQuestion] = useState(draft);
  const [share, setShare] = useState(false); // explicit opt-in
  const [preview, setPreview] = useState(false);
  const ask = useAsk();
  const diag = useDiagnostics(module, dashboardId, share);

  useEffect(() => setQuestion(draft), [draft]);

  const submit = (q: string) => {
    if (q.trim().length < 3) return;
    ask.mutate(
      { question: q.trim(), module, thread_id: threadId, ...(share && diag.error ? { error: diag.error } : {}), ...(share && diag.context && Object.keys(diag.context).length ? { context: diag.context } : {}) },
      { onSuccess: (s) => (setQuestion(""), onAsked(s)) },
    );
  };

  return (
    <div className="flex flex-col gap-2.5">
      {!threadId && (
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS[module].map((s) => (
            <button key={s} type="button" onClick={() => submit(s)} disabled={ask.isPending} className="rounded-full border border-line px-3 py-1 text-[13px] text-muted hover:text-text disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
      )}
      {diag.hasAnything && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-line p-2.5">
          <label className="flex items-start gap-2 text-[13px]">
            <Checkbox checked={share} onCheckedChange={(v) => setShare(Boolean(v))} className="mt-0.5" />
            <span>
              Share diagnostics from {MODULE_LABEL[module]}
              {diag.recent.length ? ` (${diag.recent.length} recent error${diag.recent.length > 1 ? "s" : ""})` : ""}. Error messages and settings only, with sensitive values removed. Never your data.
              {share && (
                <>
                  {" "}
                  <button type="button" className="text-highlight underline-offset-2 hover:underline" onClick={() => setPreview((p) => !p)}>
                    {preview ? "Hide" : "Review"}
                  </button>
                </>
              )}
            </span>
          </label>
          {share && preview && (
            <pre className="max-h-44 overflow-auto rounded-lg bg-surface-2 p-2 text-[11px] whitespace-pre-wrap break-words">
              {diag.loading ? "Loading…" : JSON.stringify({ error: diag.error ?? null, context: diag.context }, null, 2)}
            </pre>
          )}
        </div>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
      >
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, 2000))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(question);
            }
          }}
          rows={2}
          placeholder={threadId ? "Ask a follow-up…" : "Describe the problem. Don't include passwords or customer data."}
          aria-label="Your question"
          className="min-h-[44px] flex-1 resize-none"
        />
        <Button type="submit" size="icon" aria-label="Send" disabled={question.trim().length < 3 || ask.isPending}>
          <Send />
        </Button>
      </form>
      {ask.isError && <p className="text-[13px] text-accent">{ask.error.message}</p>}
    </div>
  );
}

function HistoryTab({ onOpenThread, canListTickets }: { onOpenThread: (id: string) => void; canListTickets: boolean }) {
  const threads = useThreads(true);
  const tickets = useSupportConversations(canListTickets);
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-highlight" aria-hidden /> Assistant conversations
        </h3>
        {threads.isPending ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : !threads.data?.length ? (
          <p className="text-sm text-muted">No conversations yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {threads.data.map((t) => (
              <li key={t.thread_id}>
                <button type="button" onClick={() => onOpenThread(t.thread_id)} className="flex w-full flex-col gap-0.5 py-2.5 text-left hover:text-text">
                  <span className="truncate text-sm">{t.title}</span>
                  <span className="text-[12px] text-faint">
                    {MODULE_LABEL[t.module]} · {t.turns} question{t.turns > 1 ? "s" : ""} · {formatDistanceToNow(new Date(t.last_at), { addSuffix: true })}
                    {t.feedback === "resolved" ? " · solved" : t.escalated ? " · sent to support" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {canListTickets && (
        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <MessagesSquare className="size-4 text-highlight" aria-hidden /> Support tickets
          </h3>
          {tickets.isPending ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : tickets.isError ? (
            <p className="text-sm text-accent">{tickets.error.message}</p>
          ) : !tickets.data?.length ? (
            <p className="text-sm text-muted">No tickets yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {tickets.data.map((c) => (
                <li key={c.id} className="flex items-center gap-2 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">Ticket #{c.id}</span>
                    {c.last_message && <span className="block truncate text-[12px] text-faint">{c.last_message.from === "you" ? "You: " : "Support: "}{c.last_message.text}</span>}
                  </span>
                  <Badge variant={c.status === "resolved" ? "secondary" : "primary-light"}>{c.status === "resolved" ? "Resolved" : "Open"}</Badge>
                  <Button size="sm" variant="outline" onClick={() => openSupportChat()}>
                    Open
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/** The AI support assistant: a side panel available on every page of the signed-in app. */
export function AssistantPanel() {
  const open = useAssistantStore((s) => s.open);
  const setOpen = useAssistantStore((s) => s.setOpen);
  const pathname = usePathname();
  const [tab, setTab] = useState("ask");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [turns, setTurns] = useState<AssistantSession[]>([]);
  const [articleId, setArticleId] = useState<string | null>(null);
  const page = pathname === "/support" ? previousAppPage() : pathname;
  const detected = useMemo(() => moduleFromPath(page), [page]);
  const [module, setModule] = useState<AssistantModule>(detected.module);
  const thread = useThread(threadId && !turns.length ? threadId : null);
  const { data: config } = useSupportConfig();
  const canEscalate = Boolean(config?.enabled && config.can_list_conversations);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && !threadId) setModule(detected.module);
  }, [open, detected.module, threadId]);
  useEffect(() => {
    if (thread.data) setTurns(thread.data);
  }, [thread.data]);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [turns.length]);

  const newConversation = () => (setThreadId(null), setTurns([]), setTab("ask"));

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b border-line">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-[18px] text-highlight" aria-hidden /> AI support assistant
          </SheetTitle>
          <SheetDescription>Explains errors and suggests what to try, using Vyuham&apos;s tested help articles.</SheetDescription>
        </SheetHeader>
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
            <TabsList>
              <TabsTrigger value="ask">
                <Sparkles /> Ask
              </TabsTrigger>
              <TabsTrigger value="history">
                <History /> History
              </TabsTrigger>
            </TabsList>
            {(threadId || turns.length > 0) && (
              <Button size="sm" variant="ghost" onClick={newConversation}>
                <Plus /> New
              </Button>
            )}
          </div>

          <TabsContent value="ask" className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
              {turns.length === 0 && (
                <div className="flex flex-col gap-3">
                  <label className="flex flex-wrap items-center gap-2 text-sm text-muted">
                    Helping with
                    <select
                      value={module}
                      onChange={(e) => setModule(e.target.value as AssistantModule)}
                      className="rounded-lg border border-line bg-transparent px-2 py-1 text-sm text-text"
                      aria-label="Which part of Vyuham"
                    >
                      {PICKABLE.map((m) => (
                        <option key={m} value={m} className="bg-surface-2">
                          {MODULE_LABEL[m]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="flex items-start gap-2 text-[13px] text-muted">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-highlight" aria-hidden />
                    Answers show which steps are <strong className="font-medium text-text">verified fixes</strong> from tested articles and which are <strong className="font-medium text-text">suggestions</strong>.
                  </p>
                </div>
              )}
              {thread.isPending && threadId && !turns.length && <p className="text-sm text-muted">Loading conversation…</p>}
              {turns.map((s) => (
                <AnswerCard key={s.id} initial={s} canEscalate={canEscalate} onOpenArticle={setArticleId} />
              ))}
              <div ref={bottom} />
            </div>
            <div className="border-t border-line px-4 py-3">
              <Composer
                key={`${module}:${threadId ?? "new"}`}
                module={turns[0]?.module ?? module}
                dashboardId={detected.module === module ? detected.dashboardId : undefined}
                threadId={threadId ?? undefined}
                onAsked={(s) => (setThreadId(s.thread_id), setTurns((t) => [...t, s]))}
              />
              {config?.help_center_url && (
                <a href={config.help_center_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-faint hover:text-text">
                  <BookOpen className="size-3.5" aria-hidden /> Browse all help articles
                </a>
              )}
            </div>
          </TabsContent>

          <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {threadId && turns.length > 0 && (
              <Button size="sm" variant="ghost" className="mb-3" onClick={() => setTab("ask")}>
                <ArrowLeft /> Back to the current conversation
              </Button>
            )}
            <HistoryTab canListTickets={canEscalate} onOpenThread={(id) => (setTurns([]), setThreadId(id), setTab("ask"))} />
          </TabsContent>
        </Tabs>
        <ArticleDialog id={articleId} onClose={() => setArticleId(null)} />
      </SheetContent>
    </Sheet>
  );
}
