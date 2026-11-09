"use client";

import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type Props = {
  /** Renders the trigger; spread the props onto a <button>. */
  trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-controls": string }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "start" | "end";
  className?: string;
};

/** Minimal accessible popover: closes on outside click, Escape (returning focus) and via `close()`. */
export function Popover({ trigger, children, align = "start", className }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-controls": id })}
      {open && (
        <div
          id={id}
          data-lenis-prevent
          className={cn(
            "absolute top-[calc(100%+8px)] z-40 max-w-[calc(100vw-32px)] rounded-[14px] border border-white/10 bg-[#110e22] p-3 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.9)]",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
