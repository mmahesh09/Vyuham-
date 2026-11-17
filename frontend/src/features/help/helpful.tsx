"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

/** "Was this helpful?" A "no" offers a ticket, so a weak article turns into a better one. */
export function Helpful({ slug }: { slug: string }) {
  const [answer, setAnswer] = useState<boolean | null>(null);

  function vote(helpful: boolean) {
    setAnswer(helpful);
    fetch(`/api/kb/articles/${encodeURIComponent(slug)}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ helpful }),
    }).catch(() => {});
  }

  if (answer === true) return <p className="text-[14px] text-muted">Thanks, glad it helped.</p>;
  if (answer === false)
    return (
      <p className="text-[14px] text-muted">
        Sorry about that.{" "}
        <Link href={`/support/new?from=${encodeURIComponent(`/help/${slug}`)}`} className="text-highlight hover:underline">
          Tell us what you&apos;re stuck on
        </Link>{" "}
        and a person will help.
      </p>
    );
  const btn = "inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[13px] text-muted hover:border-line-strong hover:text-text";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-[14px] text-text">Was this helpful?</p>
      <button type="button" className={btn} onClick={() => vote(true)}>
        <ThumbsUp className="size-3.5" aria-hidden /> Yes
      </button>
      <button type="button" className={btn} onClick={() => vote(false)}>
        <ThumbsDown className="size-3.5" aria-hidden /> No
      </button>
    </div>
  );
}
