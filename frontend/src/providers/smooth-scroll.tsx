"use client";

import "lenis/dist/lenis.css";

import { ReactLenis } from "lenis/react";
import { useEffect, useState } from "react";

/**
 * Site-wide smooth scrolling (Lenis). Off for people who prefer reduced motion.
 * Inner scroll areas opt out with the `data-lenis-prevent` attribute.
 */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setEnabled(!mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (!enabled) return <>{children}</>;
  return (
    <ReactLenis root options={{ lerp: 0.1, anchors: { offset: -16 }, autoRaf: true }}>
      {children}
    </ReactLenis>
  );
}
