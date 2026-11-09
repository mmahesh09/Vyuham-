"use client";

import { useEffect, useState } from "react";

const TYPE_MS = 70;
const DELETE_MS = 35;
const HOLD_MS = 1800;

/** Types each phrase, holds, deletes, moves on. Shows the first phrase still when motion is reduced. */
export function Typewriter({ phrases }: { phrases: string[] }) {
  const [index, setIndex] = useState(0);
  const [text, setText] = useState(phrases[0]);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const phrase = phrases[index];
    let delay = deleting ? DELETE_MS : TYPE_MS;
    if (!deleting && text === phrase) delay = HOLD_MS;

    const t = setTimeout(() => {
      if (!deleting && text === phrase) setDeleting(true);
      else if (deleting && text === "") {
        setDeleting(false);
        setIndex((i) => (i + 1) % phrases.length);
      } else setText(deleting ? phrase.slice(0, text.length - 1) : phrase.slice(0, text.length + 1));
    }, delay);
    return () => clearTimeout(t);
  }, [text, deleting, index, phrases]);

  return (
    <span className="sm:whitespace-nowrap">
      {text}
      <span className="caret ml-1 inline-block h-[0.85em] w-[3px] translate-y-[0.08em] bg-accent" aria-hidden />
    </span>
  );
}
