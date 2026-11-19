"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export type PostSection = { id: string; title: string };

/** The post's sections, with the one being read marked as it scrolls past. */
export function PostContents({ sections }: { sections: PostSection[] }) {
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    const headings = sections.flatMap(({ id }) => document.getElementById(id) ?? []);
    let frame = 0;
    // The current section is the last heading that has reached the top of the reading area.
    const update = () => {
      frame = 0;
      const passed = headings.filter((h) => h.getBoundingClientRect().top <= 140).at(-1);
      setActive((passed ?? headings[0])?.id);
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [sections]);

  return (
    <nav aria-label="In this article" className="sticky top-24">
      <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.16em] text-faint">In this article</p>
      <ol className="flex flex-col border-l border-line">
        {sections.map(({ id, title }) => (
          <li key={id}>
            <a
              href={`#${id}`}
              aria-current={active === id ? "location" : undefined}
              className={cn(
                "-ml-px block border-l py-1.5 pl-4 text-[13px] leading-snug transition-colors",
                active === id ? "border-highlight text-text" : "border-transparent text-faint hover:text-text",
              )}
            >
              {title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
