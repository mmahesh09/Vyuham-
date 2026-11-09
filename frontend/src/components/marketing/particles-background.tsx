"use client";

import { useEffect, useState, type ComponentProps } from "react";

import { Particles } from "@/components/ui/particles";

/**
 * Magic UI particles that stay out of the way: hidden when the viewer prefers reduced motion.
 * Note: the Magic UI component draws twice `quantity`, so pass half the number you want.
 */
export function ParticlesBackground(props: ComponentProps<typeof Particles>) {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setAllowed(!mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return allowed ? <Particles {...props} /> : null;
}
