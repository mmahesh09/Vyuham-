"use client";

import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  HelpCircle,
  Lightbulb,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDebounced } from "@/lib/use-debounced";
import { cn } from "@/lib/utils";

import { CATEGORY_LABEL, logDeflection, useArticleSearch, useCreateTicket, type Category, type TicketDetail } from "./api";
import { AttachmentPicker, useAttachments } from "./attachments";

const EVENT_ID = /^[A-Za-z0-9-]{1,64}$/;
const panel = "rounded-[18px] border border-line bg-surface";

const CATEGORIES: { id: Category; icon: LucideIcon; text: string }[] = [
  { id: "bug", icon: AlertTriangle, text: "An error, numbers that look wrong, or a page that won't load." },
  { id: "question", icon: HelpCircle, text: "Help with a feature, or a step you're stuck on." },
  { id: "billing", icon: CreditCard, text: "Plans, payments, signing in or your email address." },
  { id: "feature", icon: Lightbulb, text: "Something you'd like Vyuham to do." },
];

const PLACEHOLDER: Record<Category, { subject: string; body: string }> = {
  bug: {
    subject: "e.g. My revenue chart shows zero after uploading",
    body: "What were you doing, what did you expect, and what happened instead? Which dashboard or file?",
  },
  question: { subject: "e.g. How do I share a dashboard with a client?", body: "What are you trying to do, and where did you get stuck?" },
  billing: { subject: "e.g. I need an invoice for last month", body: "Tell us what you need. Don't include card numbers." },
  feature: { subject: "e.g. Export a dashboard to PowerPoint", body: "What would you like to do, and what would it help you with?" },
};

type Errors = Partial<Record<"subject" | "body" | "errorRef", string>>;

function checkSubject(s: string) {
  const v = s.trim();
  if (v.length < 3) return "Add a short summary (at least 3 characters).";
  if (v.length > 200) return "Keep the summary under 200 characters.";
}

function validate(subject: string, body: string, errorRef: string): Errors {
  const e: Errors = {};
  const s = checkSubject(subject);
  if (s) e.subject = s;
  if (body.trim().length < 10) e.body = "Tell us a little more (at least 10 characters).";
  const r = errorRef.trim();
  if (r && !EVENT_ID.test(r)) e.errorRef = "Error references contain only letters, numbers and dashes.";
  return e;
}

const STEPS = ["Topic", "Your question", "Details"] as const;

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  return (
    <ol className="flex items-center gap-2 text-[12.5px]" aria-label="Progress">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full border text-[11.5px] font-semibold",
                done && "border-primary/40 bg-primary/15 text-highlight",
                current && "border-highlight bg-highlight text-bg",
                !done && !current && "border-line text-faint",
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : n}
            </span>
            <span className={cn("hidden sm:inline", current ? "font-medium text-text" : "text-faint")}>{label}</span>
            {n < STEPS.length && <span className="h-px w-5 bg-line sm:w-8" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

export function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard?.writeText(id).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          },
          () => {},
        )
      }
      className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-1.5 font-mono text-[12.5px] text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-highlight"
      aria-label={copied ? "Request ID copied" : `Copy request ID ${id}`}
    >
      {id.slice(0, 8)}
      {copied ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}

/**
 * The one way to ask for help, on the public support center and in the app:
 * pick a topic, write a one-line summary (matching articles show up as you type), then the details.
 */
export function GuidedRequest({ pageUrl, onSent }: { pageUrl?: string; onSent?: (t: TicketDetail) => void }) {
  const params = useSearchParams();
  const fromError = params.get("error");
  const presetRef = fromError && EVENT_ID.test(fromError) ? fromError : "";
  const ids = useId();
  const fieldId = (k: string) => `${ids}-${k}`;

  const [step, setStep] = useState<1 | 2 | 3>(presetRef ? 2 : 1);
  const [category, setCategory] = useState<Category>(presetRef ? "bug" : "question");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [errorRef, setErrorRef] = useState(presetRef);
  const [showRef, setShowRef] = useState(!!presetRef);
  const [errors, setErrors] = useState<Errors>({});
  const [sent, setSent] = useState<TicketDetail | null>(null);
  const [answered, setAnswered] = useState(false);
  const files = useAttachments();
  const create = useCreateTicket();

  const query = useDebounced(subject, 350);
  const { data: suggestions } = useArticleSearch(query);
  const showSuggestions = !!suggestions?.length && subject.trim().length >= 4;

  // Move focus to the new step's heading so keyboard and screen reader users land in the right place.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step, sent, answered]);

  function restart() {
    setSent(null);
    setAnswered(false);
    setStep(1);
    setSubject("");
    setBody("");
    setErrorRef("");
    setShowRef(false);
    setErrors({});
    files.reset();
    create.reset();
  }

  if (answered) {
    return (
      <div className={`${panel} flex flex-col items-start gap-4 p-6 sm:p-8`} role="status">
        <span className="flex size-11 items-center justify-center rounded-xl bg-success/15 text-success">
          <CheckCircle2 className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1.5">
          <h3 ref={headingRef} tabIndex={-1} className="text-[18px] font-semibold tracking-[-0.015em] text-text outline-none">
            Glad that helped
          </h3>
          <p className="max-w-[52ch] text-[15px] leading-relaxed text-muted">If anything else comes up, we&apos;re right here.</p>
        </div>
        <Button variant="outline" onClick={restart}>
          Ask something else
        </Button>
      </div>
    );
  }

  if (sent) {
    return (
      <div className={`${panel} flex flex-col items-start gap-5 p-6 sm:p-8`} role="status">
        <span className="flex size-11 items-center justify-center rounded-xl bg-success/15 text-success">
          <CheckCircle2 className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1.5">
          <h3 ref={headingRef} tabIndex={-1} className="text-[18px] font-semibold tracking-[-0.015em] text-text outline-none">
            Thanks, we&apos;ve got it
          </h3>
          <p className="max-w-[56ch] text-[15px] leading-relaxed text-muted">
            &ldquo;{sent.subject}&rdquo; is with the team. A person will reply in the conversation, and we&apos;ll email you when
            they do.
          </p>
          <p className="flex items-center gap-1 text-[13px] text-faint">
            Request ID <CopyId id={sent.id} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button nativeButton={false} render={<Link href={`/support/${sent.id}`} />}>
            View conversation <ArrowRight aria-hidden />
          </Button>
          <Button variant="outline" onClick={restart}>
            Send another request
          </Button>
        </div>
      </div>
    );
  }

  const ph = PLACEHOLDER[category];
  const heading = "text-[17px] font-semibold tracking-[-0.015em] text-text outline-none";

  return (
    <div className={`${panel} flex flex-col gap-6 p-5 sm:p-7`}>
      <StepIndicator step={step} />

      {step === 1 && (
        <fieldset className="flex flex-col gap-4">
          <legend className="contents">
            <h3 ref={headingRef} tabIndex={-1} className={heading}>
              What can we help with?
            </h3>
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {CATEGORIES.map(({ id, icon: Icon, text }) => (
              <button
                key={id}
                type="button"
                aria-pressed={category === id}
                onClick={() => {
                  setCategory(id);
                  setStep(2);
                }}
                className={cn(
                  "group flex min-h-[88px] items-start gap-3.5 rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight",
                  category === id && subject ? "border-primary/50 bg-primary/[0.05]" : "border-line bg-bg/40 hover:border-primary/40 hover:bg-primary/[0.03]",
                )}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-highlight">
                  <Icon className="size-[18px]" aria-hidden />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-medium text-text group-hover:text-highlight">{CATEGORY_LABEL[id]}</span>
                  <span className="text-[13px] leading-snug text-muted">{text}</span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {step === 2 && (
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            const err = checkSubject(subject);
            setErrors(err ? { subject: err } : {});
            if (err) document.getElementById(fieldId("subject"))?.focus();
            else setStep(3);
          }}
        >
          <h3 ref={headingRef} tabIndex={-1} className={heading}>
            In a sentence, what&apos;s going on?
          </h3>
          <Field data-invalid={!!errors.subject || undefined}>
            <FieldLabel htmlFor={fieldId("subject")}>Summary</FieldLabel>
            <Input
              id={fieldId("subject")}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={ph.subject}
              maxLength={200}
              autoComplete="off"
              aria-invalid={!!errors.subject}
              aria-describedby={errors.subject ? fieldId("subject-err") : fieldId("subject-hint")}
            />
            {errors.subject ? (
              <FieldError id={fieldId("subject-err")}>{errors.subject}</FieldError>
            ) : (
              <FieldDescription id={fieldId("subject-hint")}>We&apos;ll look for help articles that match as you type.</FieldDescription>
            )}
          </Field>

          <div aria-live="polite">
            {showSuggestions && (
              <div className="flex flex-col gap-2.5 rounded-xl border border-highlight/30 bg-highlight/5 p-4">
                <p className="flex items-center gap-2 text-[14px] font-medium text-text">
                  <BookOpen className="size-4 text-highlight" aria-hidden /> These articles might answer it right away
                </p>
                <ul className="flex flex-col gap-0.5">
                  {suggestions.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/help/${a.slug}`}
                        target="_blank"
                        onClick={() => logDeflection(a.id)}
                        className="group flex flex-col rounded-lg px-2 py-1.5 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-highlight"
                      >
                        <span className="text-[14.5px] font-medium text-highlight group-hover:underline">
                          {a.title} <span className="sr-only">(opens in a new tab)</span>
                        </span>
                        {a.summary && <span className="line-clamp-2 text-[13px] text-muted">{a.summary}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-2 border-t border-highlight/15 pt-3 text-[13px] text-muted">
                  <span>Did one of these answer it?</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setAnswered(true)}>
                    Yes, all sorted
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="ghost" onClick={() => setStep(1)}>
              <ArrowLeft aria-hidden /> Back
            </Button>
            <Button type="submit">
              {showSuggestions ? "I still need help" : "Continue"} <ArrowRight aria-hidden />
            </Button>
          </div>
        </form>
      )}

      {step === 3 && (
        <form
          noValidate
          aria-label="Contact support"
          className="flex flex-col gap-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (files.uploading) return;
            const found = validate(subject, body, errorRef);
            setErrors(found);
            const first = (["body", "errorRef"] as const).find((k) => found[k]);
            if (found.subject) {
              setStep(2);
              return;
            }
            if (first) {
              document.getElementById(fieldId(first))?.focus();
              return;
            }
            const t = await create
              .mutateAsync({
                subject: subject.trim(),
                body: body.trim(),
                category,
                error_event_id: errorRef.trim() || undefined,
                page_url: pageUrl,
                attachment_ids: files.ids,
              })
              .catch(() => null);
            if (!t) return;
            files.reset();
            if (onSent) onSent(t);
            else setSent(t);
          }}
        >
          <div className="flex flex-col gap-2">
            <h3 ref={headingRef} tabIndex={-1} className={heading}>
              Tell us the details
            </h3>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-line bg-bg/40 px-3.5 py-2.5 text-[13.5px]">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[12px] text-highlight">{CATEGORY_LABEL[category]}</span>
              <span className="min-w-0 flex-1 truncate text-text">{subject.trim()}</span>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-faint hover:text-text focus-visible:outline-2 focus-visible:outline-highlight"
              >
                <Pencil className="size-3.5" aria-hidden /> Edit
              </button>
            </p>
          </div>

          <Field data-invalid={!!errors.body || undefined}>
            <FieldLabel htmlFor={fieldId("body")}>What happened?</FieldLabel>
            <Textarea
              id={fieldId("body")}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onPaste={files.onPaste}
              rows={6}
              maxLength={10_000}
              autoFocus
              placeholder={ph.body}
              aria-invalid={!!errors.body}
              aria-describedby={errors.body ? `${fieldId("body-err")} ${fieldId("body-hint")}` : fieldId("body-hint")}
            />
            {errors.body && <FieldError id={fieldId("body-err")}>{errors.body}</FieldError>}
            <FieldDescription id={fieldId("body-hint")}>Please don&apos;t paste passwords or card numbers.</FieldDescription>
          </Field>

          <AttachmentPicker state={files} />

          {showRef ? (
            <Field data-invalid={!!errors.errorRef || undefined}>
              <FieldLabel htmlFor={fieldId("errorRef")}>
                Error reference <span className="font-normal text-faint">(optional)</span>
              </FieldLabel>
              <Input
                id={fieldId("errorRef")}
                value={errorRef}
                onChange={(e) => setErrorRef(e.target.value)}
                placeholder="Shown on the error screen, e.g. 3f2a9c1e…"
                maxLength={64}
                className="font-mono"
                aria-invalid={!!errors.errorRef}
                aria-describedby={errors.errorRef ? `${fieldId("ref-err")} ${fieldId("ref-hint")}` : fieldId("ref-hint")}
              />
              {errors.errorRef && <FieldError id={fieldId("ref-err")}>{errors.errorRef}</FieldError>}
              <FieldDescription id={fieldId("ref-hint")}>
                {presetRef ? "We filled this in from the error you just saw, so we can see exactly what failed." : "Adding it lets us see exactly what failed."}
              </FieldDescription>
            </Field>
          ) : (
            category === "bug" && (
              <button
                type="button"
                onClick={() => setShowRef(true)}
                className="w-fit text-[13.5px] text-highlight hover:underline focus-visible:outline-2 focus-visible:outline-highlight"
              >
                + Add an error reference from the error screen
              </button>
            )
          )}

          {create.error && (
            <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-[14px] text-text">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <span>Your request wasn&apos;t sent: {create.error.message} Everything you wrote is still here, so you can try again.</span>
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="ghost" onClick={() => setStep(2)}>
              <ArrowLeft aria-hidden /> Back
            </Button>
            <Button type="submit" size="lg" disabled={create.isPending || files.uploading || files.failed}>
              {create.isPending ? "Sending…" : files.uploading ? "Uploading files…" : "Send request"}
            </Button>
          </div>
          {files.failed && <p className="-mt-2 text-right text-[13px] text-destructive">Retry or remove the file that didn&apos;t upload.</p>}
        </form>
      )}
    </div>
  );
}
