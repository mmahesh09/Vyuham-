"use client";

import { useSyncExternalStore, type ComponentProps } from "react";

import { ChartBuilder } from "../chart-builder";
import { ChartStudio } from "./chart-studio";

const WIDE = "(min-width: 1024px)";
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/**
 * Add or edit a chart: the drag-and-drop studio on wide screens, the step-by-step side panel on phones
 * (dragging between shelves needs room) and for SQL Lab charts, whose query defines them.
 */
export function ChartEditor(props: ComponentProps<typeof ChartBuilder>) {
  const wide = useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches, () => true);
  if (!wide || props.chart?.spec.sql) return <ChartBuilder {...props} />;
  return <ChartStudio {...props} />;
}
