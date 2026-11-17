"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type Hit = { id: string; slug: string; title: string; summary: string };

/** Search-as-you-type over published help articles (public, no sign-in). */
export function HelpSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/kb/search?q=${encodeURIComponent(term)}&limit=8`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then(setHits)
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-3 rounded-full border border-line-strong bg-surface px-5 py-3 focus-within:border-highlight">
        <Search className="size-4 text-faint" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the help center, e.g. upload, share link, wrong totals"
          className="w-full bg-transparent text-[16px] text-text outline-none placeholder:text-faint"
          aria-label="Search help articles"
        />
      </label>
      {hits && (
        <div aria-live="polite">
          {hits.length === 0 ? (
            <p className="px-2 text-[14px] text-muted">
              Nothing matches yet.{" "}
              <Link href="/support/new" className="text-highlight hover:underline">
                Ask us directly
              </Link>{" "}
              and we&apos;ll write it up.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
              {hits.map((h) => (
                <li key={h.id}>
                  <Link href={`/help/${h.slug}`} className="flex flex-col gap-0.5 px-5 py-3 hover:bg-surface-2">
                    <span className="font-medium text-text">{h.title}</span>
                    {h.summary && <span className="text-[13.5px] text-muted">{h.summary}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
