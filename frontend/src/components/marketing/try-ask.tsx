"use client";

import { ArrowUpRight, Sparkle } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export type TryQuestion = { q: string; answer: string; panel: React.ReactNode };

/**
 * A scripted "ask" box for the no-login demo: pick a question, it types itself, then the canned answer and
 * the matching sample chart appear. No AI call; everything is sample data.
 */
export function TryAsk({ questions }: { questions: TryQuestion[] }) {
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState(questions[0]?.q ?? "");
  const [done, setDone] = useState(true);
  const current = questions[active];

  useEffect(() => {
    if (done) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setTyped(current.q);
      setDone(true);
      return;
    }
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(current.q.slice(0, i));
      if (i >= current.q.length) {
        window.clearInterval(id);
        window.setTimeout(() => setDone(true), 350);
      }
    }, 22);
    return () => window.clearInterval(id);
  }, [current, done]);

  function pick(i: number) {
    if (i === active && done) return;
    setActive(i);
    setTyped("");
    setDone(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <div role="group" aria-label="Sample questions" className="-mx-1 flex flex-wrap gap-2 px-1">
        {questions.map((item, i) => (
          <button
            key={item.q}
            type="button"
            onClick={() => pick(i)}
            aria-pressed={i === active}
            className={cn(
              "min-h-11 rounded-full border px-4 text-left text-[14px] transition-colors",
              i === active
                ? "border-primary/70 bg-primary/15 text-white"
                : "border-white/10 bg-white/[0.04] text-white/70 hover:border-white/25 hover:text-white",
            )}
          >
            {item.q}
          </button>
        ))}
      </div>

      <div className="glass-strong rounded-[24px] p-3 sm:p-4">
        <div className="flex items-center gap-3 rounded-[16px] border border-primary/60 bg-black/40 px-4 py-3">
          <Sparkle className="size-5 shrink-0 text-highlight" strokeWidth={2} aria-hidden />
          <span className="min-w-0 flex-1 text-[15px] text-white" aria-live="polite">
            {typed}
            {!done && <span className="ml-0.5 inline-block h-4 w-px animate-pulse bg-white align-middle" aria-hidden />}
          </span>
        </div>

        <div className={cn("transition-opacity duration-300", done ? "opacity-100" : "opacity-0")} aria-hidden={!done}>
          <p className="flex items-start gap-2 px-2 pb-4 pt-5 text-[17px] font-medium tracking-tight text-white sm:text-xl">
            <ArrowUpRight className="mt-1 size-5 shrink-0 text-highlight" strokeWidth={2.4} aria-hidden />
            {current.answer}
          </p>
          <div className="min-w-0">{current.panel}</div>
        </div>
      </div>
      <p className="text-center text-[13px] text-white/40">Sample data. Answers here are scripted to show how it works.</p>
    </div>
  );
}
