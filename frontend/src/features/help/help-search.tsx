"use client";

import { ArrowRight, Loader2, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type Hit = { id: string; slug: string; title: string; summary: string; tags: string[] };
type State =
  | { kind: "idle" }
  | { kind: "loading"; prev: Hit[] | null }
  | { kind: "done"; hits: Hit[]; term: string }
  | { kind: "error" };

/**
 * Search-as-you-type over published help articles (public, no sign-in). An ARIA combobox:
 * arrow keys move through results, Enter opens one, Escape clears.
 */
export function HelpSearch({ size = "default", suggestions = [] }: { size?: "default" | "lg"; suggestions?: string[] }) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setState({ kind: "idle" });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ kind: "loading", prev: s.kind === "done" ? s.hits : s.kind === "loading" ? s.prev : null }));
    const t = setTimeout(() => {
      fetch(`/api/kb/search?q=${encodeURIComponent(term)}&limit=8`, { signal: ctrl.signal })
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json() as Promise<Hit[]>;
        })
        .then((hits) => {
          setState({ kind: "done", hits, term });
          setActive(-1);
        })
        .catch((e: unknown) => {
          if (!(e instanceof DOMException && e.name === "AbortError")) setState({ kind: "error" });
        });
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const hits = state.kind === "done" ? state.hits : state.kind === "loading" ? state.prev : null;
  const open = q.trim().length >= 2 && state.kind !== "idle";
  const showList = !!hits?.length && open;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setQ("");
      return;
    }
    if (!hits?.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? hits.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      router.push(`/help/${hits[active].slug}`);
    }
  }

  const lg = size === "lg";

  return (
    <div className="relative flex flex-col gap-3" role="search">
      <div
        className={cn(
          "flex items-center gap-3 rounded-full border border-line-strong bg-surface transition-colors focus-within:border-highlight focus-within:ring-[3px] focus-within:ring-highlight/20",
          lg ? "px-5 py-3.5 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.8)] sm:px-6 sm:py-4" : "px-5 py-3",
        )}
      >
        {state.kind === "loading" ? (
          <Loader2 className="size-[18px] shrink-0 animate-spin text-faint" aria-hidden />
        ) : (
          <Search className="size-[18px] shrink-0 text-faint" aria-hidden />
        )}
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && showList ? `${listId}-${active}` : undefined}
          aria-label="Search help articles"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search for answers, e.g. upload, share link, wrong totals"
          className={cn(
            "w-full min-w-0 bg-transparent text-text outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden",
            lg ? "text-[16px] sm:text-[17px]" : "text-[16px]",
          )}
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              inputRef.current?.focus();
            }}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-faint hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-highlight"
            aria-label="Clear search"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      {!open && suggestions.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 px-1 text-[13px] text-faint">
          <span>Try:</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setQ(s);
                inputRef.current?.focus();
              }}
              className="rounded-full border border-line px-2.5 py-1 text-muted transition-colors hover:border-line-strong hover:text-text focus-visible:outline-2 focus-visible:outline-highlight"
            >
              {s}
            </button>
          ))}
        </p>
      )}

      <div aria-live="polite" className="contents">
        {open && state.kind === "error" && (
          <p className="rounded-xl border border-line bg-surface px-5 py-4 text-[14px] text-muted">
            Search isn&apos;t responding right now.{" "}
            <Link href="/help" className="text-highlight hover:underline">
              Browse all articles
            </Link>{" "}
            instead.
          </p>
        )}
        {open && state.kind === "done" && state.hits.length === 0 && (
          <div className="rounded-xl border border-line bg-surface px-5 py-4 text-[14px] text-muted">
            <p className="font-medium text-text">No articles match &ldquo;{state.term}&rdquo;.</p>
            <p className="mt-1">
              Try a shorter phrase or a single word, browse{" "}
              <Link href="/help" className="text-highlight hover:underline">
                all articles
              </Link>
              , or{" "}
              <Link href="/support-center#contact" className="text-highlight hover:underline">
                ask the team
              </Link>
              .
            </p>
          </div>
        )}
        {showList && (
          <>
            <p className="sr-only">
              {hits.length} result{hits.length === 1 ? "" : "s"}
            </p>
            <ul id={listId} role="listbox" aria-label="Matching articles" className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface text-left">
              {hits.map((h, i) => (
                <li key={h.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                  <Link
                    href={`/help/${h.slug}`}
                    tabIndex={-1}
                    onMouseEnter={() => setActive(i)}
                    className={cn("group flex items-center gap-3 px-5 py-3", i === active ? "bg-surface-2" : "hover:bg-surface-2")}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-medium text-text">{h.title}</span>
                      {h.summary && <span className="line-clamp-1 text-[13.5px] text-muted">{h.summary}</span>}
                    </span>
                    <ArrowRight className={cn("size-4 shrink-0 text-faint", i === active && "text-highlight")} aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
