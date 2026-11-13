"use client";

import { Loader2, Sparkle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ChartBody, InsightHeadline } from "@/features/dashboards/insight-card";

import { useAsk, useAskSuggestions } from "./ask-api";
import { SaveToDashboard } from "./save-to-dashboard";

/** Home's question box: rule-based answers for now (AI next round), each one a chart you can save. */
export function AskBox() {
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const ask = useAsk();
  const suggestions = useAskSuggestions();
  const asked = useRef<string | null>(null);

  // A question passed in from the command menu (?q=…) is asked straight away.
  useEffect(() => {
    const fromUrl = params.get("q");
    if (fromUrl && asked.current !== fromUrl) {
      asked.current = fromUrl;
      setQ(fromUrl);
      ask.mutate(fromUrl);
    }
  }, [params, ask]);

  const submit = (question: string) => {
    if (question.trim().length < 2) return;
    setQ(question);
    ask.mutate(question.trim());
  };
  const answer = ask.data;

  return (
    <div className="flex flex-col gap-5">
      <form
        data-tour="ask"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
        className="flex flex-wrap gap-2 rounded-2xl border border-line-strong bg-surface p-2 shadow-[0_24px_60px_-32px_rgba(112,92,187,0.55)] transition-colors focus-within:border-highlight/70"
      >
        <label htmlFor="ask" className="sr-only">
          Ask a question about your data
        </label>
        <input
          id="ask"
          type="text"
          value={q}
          maxLength={300}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. Top 5 clients by revenue this year"
          className="min-h-12 min-w-0 flex-[1_1_260px] bg-transparent px-4 text-[17px] text-text placeholder:text-faint focus:outline-none"
        />
        <button
          type="submit"
          disabled={ask.isPending}
          className="flex min-h-12 items-center gap-2 rounded-xl bg-primary px-6 font-semibold text-text transition-colors hover:bg-primary/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight disabled:opacity-70"
        >
          {ask.isPending ? <Loader2 className="size-[18px] animate-spin" aria-hidden /> : <Sparkle className="size-[18px]" strokeWidth={2} aria-hidden />}
          Ask
        </button>
      </form>

      {!!suggestions.data?.length && (
        <ul className="flex flex-wrap gap-2.5" aria-label="Example questions">
          {suggestions.data.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => submit(s)}
                className="flex min-h-9 items-center rounded-full border border-line px-3.5 text-[13.5px] text-muted transition-colors hover:border-line-strong hover:bg-surface hover:text-text"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div aria-live="polite">
        {ask.isError && <p className="text-sm text-accent">{ask.error.message}</p>}
        {answer && !answer.answered && (
          <div className="flex flex-col gap-3 rounded-xl border border-dashed border-line-strong p-5">
            <p className="text-[15px] text-muted">{answer.message}</p>
            {!!answer.suggestions.length && (
              <div className="flex flex-wrap gap-2">
                {answer.suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => submit(s)} className="rounded-full border border-line px-3 py-1.5 text-sm text-highlight hover:bg-surface">
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {answer?.answered && answer.spec && (
          <article className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface p-5 sm:p-6" aria-label="Answer">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1.5">
                <InsightHeadline insight={answer.insight} fallback={answer.spec.title} />
                <p className="pl-6 text-[14px] text-muted">{answer.insight?.note}</p>
              </div>
              <SaveToDashboard spec={answer.spec} />
            </div>
            <ChartBody spec={answer.spec} rows={answer.rows} />
            <p className="mt-3 text-[12px] text-faint">
              Read as {answer.understood.join(", ")}, from {answer.dataset_name}
              {answer.date_from && answer.date_to ? ` (${answer.date_from} to ${answer.date_to})` : ""}. Not what you meant? Try naming the column.
            </p>
          </article>
        )}
      </div>
    </div>
  );
}
