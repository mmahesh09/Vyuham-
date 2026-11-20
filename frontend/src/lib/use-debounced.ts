"use client";

import { useEffect, useState } from "react";

/** `value`, once it has stopped changing for `ms`: for inputs that drive a request on every keystroke. */
export function useDebounced<T>(value: T, ms = 350): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setCurrent(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return current;
}
