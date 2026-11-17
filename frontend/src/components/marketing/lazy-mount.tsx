"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Renders `children` only once the box comes near the viewport. Until then it keeps the space (so the
 * page doesn't jump) and costs nothing: heavy demos below the fold don't download or run on page load.
 */
export function LazyMount({
  children,
  minHeight,
  rootMargin = "600px 0px",
  className,
}: {
  children: React.ReactNode;
  /** Reserved height before mounting, e.g. "560px" or "clamp(400px,60vw,640px)". */
  minHeight: string;
  rootMargin?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || show) return;
    if (!("IntersectionObserver" in window)) return setShow(true);
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin, show]);

  return (
    <div ref={ref} className={cn(className)} style={show ? undefined : { minHeight }}>
      {show ? children : null}
    </div>
  );
}
