"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type Option<T extends string> = { value: T; label: React.ReactNode; icon?: React.ReactNode; title?: string };

/**
 * Pick one of a few views (Story / Canvas, 7D / 30D). Built on the Base UI toggle group, so arrow
 * keys move between options. Clicking the selected option keeps it selected.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "default",
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Option<T>[];
  /** Accessible name for the group. */
  label: string;
  size?: "sm" | "default";
  className?: string;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(v) => v[0] && onChange(v[0] as T)}
      spacing={0}
      className={cn("rounded-lg border border-line bg-surface p-0.5", className)}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          title={o.title}
          className={cn(
            "gap-1.5 rounded-md! border-0 px-3 font-medium text-muted hover:bg-transparent hover:text-text data-[pressed]:bg-line data-[pressed]:text-text",
            size === "sm" ? "h-7 text-[12.5px]" : "h-8 text-[13px]",
          )}
        >
          {o.icon}
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
