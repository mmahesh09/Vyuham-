"use client";

import { useTheme } from "next-themes";
import { useEffect, useState, type RefObject } from "react";

/**
 * The theme an element actually shows: the page theme (light, dark or system, resolved), except
 * inside a `.theme-dark` island, which always shows dark. "dark" until mounted, matching the server
 * render (dark is the default theme).
 */
export function useIslandTheme(ref: RefObject<HTMLElement | null>): "light" | "dark" {
  const { resolvedTheme } = useTheme();
  const [mode, setMode] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const inIsland = !!ref.current?.closest(".theme-dark");
    setMode(!inIsland && resolvedTheme === "light" ? "light" : "dark");
  }, [ref, resolvedTheme]);
  return mode;
}
