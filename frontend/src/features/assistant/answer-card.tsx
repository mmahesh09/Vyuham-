"use client";

import { AlertTriangle, BookOpen, Check, CircleHelp, LifeBuoy, Lightbulb, MessageCircle, Search, ShieldCheck, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { openSupportChat } from "@/features/support/widget";

import { useAssistantSession, useEscalate, useFeedback, type ArticleRef, type AssistantSession, type Confidence, type StepKind } from "./api";

const CONFIDENCE: Record<Confidence, { label: string; variant: "success-light" | "info-light" | "warning-light" | "destructive-light" }> = {
  high: { label: "Confident", variant: "success-light" },
  medium: { label: "Likely", variant: "info-light" },
  low: { label: "Not sure", variant: "warning-light" },
  insufficient_evidence: { label: "Not enough information", variant: "destructive-light" },
};

const STEP: Record<StepKind, { label: string; icon: typeof ShieldCheck; variant: "success-light" | "warning-light" | "secondary"; hint: string }> = {
  verified_fix: { label: "Verified fix", icon: ShieldCheck, variant: "success-light", hint: "From a help article our team has tested." },
  suggestion: { label: "Suggestion", icon: Lightbulb, variant: "warning-light", hint: "The assistant's best guess. Not verified by our team." },
  check: { label: "Check", icon: Search, variant: "secondary", hint: "Something to look at that narrows the problem down." },
};

function References({ refs, onOpen }: { refs: ArticleRef[]; onOpen: (id: string) => void }) {
  if (!refs.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[12px] font-medium uppercase tracking-wide text-faint">Help articles</p>
      <ul className="flex flex-col gap-1">
        {refs.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onOpen(r.id)} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2">
              <BookOpen className="mt-0.5 size-4 shrink-0 text-highlight" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block">{r.title}</span>
                <span className="text-[12px] text-faint">
                  {r.scope === "global" ? "Vyuham help" : "Your workspace"} · {r.verified ? "Tested by our team" : "Not verified"}
                  {r.cited ? " · used in this answer" : ""} · ref {r.id.slice(0, 8)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Escalate({ session }: { session: AssistantSession }) {
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [preview, setPreview] = useState(false);
  const escalate = useEscalate(session.id);
  const done = escalate.data?.conversation_id ?? session.escalated_conversation_id;

  if (done) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
        <p role="status" className="flex items-center gap-2 text-sm text-highlight">
          <Check className="size-4" aria-hidden /> Ticket #{done} created. Our team will reply in the support chat and by email.
        </p>
        <Button variant="outline" size="sm" className="self-start" onClick={() => openSupportChat()}>
          <MessageCircle /> Open support chat
        </Button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-2.5 rounded-xl border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        escalate.mutate({ message: note.trim() || undefined, include_diagnostics: consent });
      }}
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <LifeBuoy className="size-4 text-highlight" aria-hidden /> Create a support ticket
      </p>
      <p className="text-[13px] text-muted">We&apos;ll send your question and what the assistant suggested to our team.</p>
      <Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 2000))} rows={2} placeholder="Anything else we should know? (optional)" aria-label="Note for the support team" />
      <label className="flex items-start gap-2 text-[13px]">
        <Checkbox checked={consent} onCheckedChange={(v) => setConsent(Boolean(v))} className="mt-0.5" />
        <span>
          Attach diagnostics: the error details and module information you shared with the assistant. Sensitive values are removed. Never includes your data.
          {" "}
          <button type="button" className="text-highlight underline-offset-2 hover:underline" onClick={() => setPreview((p) => !p)}>
            {preview ? "Hide" : "See what's included"}
          </button>
        </span>
      </label>
      {preview && (
        <pre className="max-h-48 overflow-auto rounded-lg bg-surface-2 p-2 text-[11px] whitespace-pre-wrap break-words">
          {session.shared_context ? JSON.stringify(session.shared_context, null, 2) : "You didn't share diagnostics with the assistant, so only the error summary (if any) would be attached."}
        </pre>
      )}
      {escalate.isError && <p className="text-[13px] text-accent">{escalate.error.message}</p>}
      <Button type="submit" size="sm" className="self-start" disabled={escalate.isPending}>
        {escalate.isPending ? "Creating…" : "Create ticket"}
      </Button>
    </form>
  );
}

function Feedback({ session, canEscalate }: { session: AssistantSession; canEscalate: boolean }) {
  const feedback = useFeedback(session.id);
  const answer = session.answer!;
  const showEscalate = canEscalate && (session.feedback === "unresolved" || (answer.needs_human && session.feedback !== "resolved"));

  return (
    <div className="flex flex-col gap-2.5">
      {session.feedback === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Did this solve it?</span>
          <Button size="sm" variant="outline" disabled={feedback.isPending} onClick={() => feedback.mutate({ resolved: true })}>
            <ThumbsUp /> Yes
          </Button>
          <Button size="sm" variant="outline" disabled={feedback.isPending} onClick={() => feedback.mutate({ resolved: false })}>
            <ThumbsDown /> No
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">{session.feedback === "resolved" ? "Glad that helped. Thanks for letting us know." : "Sorry that didn't solve it."}</p>
      )}
      {feedback.isError && <p className="text-[13px] text-accent">{feedback.error.message}</p>}
      {showEscalate && <Escalate session={session} />}
      {!canEscalate && session.feedback === "unresolved" && (
        <p className="text-[13px] text-muted">Human support isn&apos;t set up for this installation yet.</p>
      )}
    </div>
  );
}

/** One question and its answer. Polls while the server is still working on it. */
export function AnswerCard({ initial, canEscalate, onOpenArticle }: { initial: AssistantSession; canEscalate: boolean; onOpenArticle: (id: string) => void }) {
  const { data: session = initial } = useAssistantSession(initial.id, initial);
  const answer = session.answer;
  const refsById = new Map(session.references.map((r) => [r.id, r]));

  return (
    <article className="flex flex-col gap-3">
      <p className="self-end rounded-2xl rounded-br-md bg-primary/15 px-3.5 py-2 text-sm whitespace-pre-wrap break-words">{session.question}</p>

      {(session.status === "queued" || session.status === "running") && (
        <p className="flex items-center gap-2 text-sm text-muted" role="status">
          <Spinner className="size-4" /> Looking through help articles and your error…
        </p>
      )}

      {session.status === "failed" && (
        <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <p className="flex items-center gap-2 text-sm text-accent">
            <AlertTriangle className="size-4" aria-hidden /> {session.failure ?? "The assistant couldn't answer."}
          </p>
          {canEscalate && <Escalate session={session} />}
        </div>
      )}

      {answer && (
        <div className="flex flex-col gap-3.5 rounded-2xl rounded-bl-md border border-line p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={CONFIDENCE[answer.confidence].variant}>{CONFIDENCE[answer.confidence].label}</Badge>
            {!answer.grounded && <Badge variant="warning-light">No verified article matched</Badge>}
          </div>
          <p className="text-[15px] whitespace-pre-wrap break-words">{answer.summary}</p>

          <div className="flex flex-col gap-1">
            <p className="text-[12px] font-medium uppercase tracking-wide text-faint">Likely cause</p>
            <p className="text-sm text-muted whitespace-pre-wrap break-words">{answer.likely_root_cause}</p>
          </div>

          {answer.steps.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] font-medium uppercase tracking-wide text-faint">Try this</p>
              <ol className="flex flex-col gap-2.5">
                {answer.steps.map((step, i) => {
                  const meta = STEP[step.kind];
                  return (
                    <li key={i} className="flex gap-2.5">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-line text-[11px] font-semibold">{i + 1}</span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <Badge variant={meta.variant} className="self-start" title={meta.hint}>
                          <meta.icon className="size-3" aria-hidden /> {meta.label}
                        </Badge>
                        {/* Plain text only: nothing the assistant writes is run or rendered as HTML. */}
                        <p className="text-sm whitespace-pre-wrap break-words">{step.text}</p>
                        {step.article_ids.length > 0 && (
                          <p className="flex flex-wrap gap-1.5 text-[12px] text-faint">
                            Source:
                            {step.article_ids.map((id) => (
                              <button key={id} type="button" className="text-highlight hover:underline" onClick={() => onOpenArticle(id)}>
                                {refsById.get(id)?.title ?? `ref ${id.slice(0, 8)}`}
                              </button>
                            ))}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {answer.uncertainty && (
            <p className="flex gap-2 rounded-lg bg-warning/10 p-2.5 text-[13px]">
              <CircleHelp className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span className="whitespace-pre-wrap break-words">{answer.uncertainty}</span>
            </p>
          )}

          <References refs={session.references} onOpen={onOpenArticle} />

          <p className="text-[11px] text-faint">
            Verified fixes come from help articles our team has tested. Suggestions are the assistant&apos;s best guess, so check them before relying on them.
            The assistant never runs anything for you: review any SQL before you use it.
          </p>

          <Feedback session={session} canEscalate={canEscalate} />
        </div>
      )}
    </article>
  );
}
