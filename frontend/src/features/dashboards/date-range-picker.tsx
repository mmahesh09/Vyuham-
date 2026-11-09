"use client";

import "react-day-picker/style.css";

import { differenceInCalendarDays, format, isSameYear, startOfDay, startOfYear, subDays } from "date-fns";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useState } from "react";
import { DayPicker, type DateRange } from "react-day-picker";

import { Popover } from "@/components/ui/simple-popover";
import { cn } from "@/lib/utils";

const today = () => startOfDay(new Date());

const PRESETS = [
  { label: "All time", from: () => null },
  { label: "7D", from: () => subDays(today(), 6) },
  { label: "30D", from: () => subDays(today(), 29) },
  { label: "90D", from: () => subDays(today(), 89) },
  { label: "This year", from: () => startOfYear(today()) },
] as const;

function rangeLabel(from: Date | null, to: Date | null) {
  if (!from || !to) return "All time";
  const sameYear = isSameYear(from, to);
  return `${format(from, sameYear ? "MMM d" : "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")}`;
}

type Props = { from: Date | null; to: Date | null; onChange: (range: { from: Date | null; to: Date | null }) => void };

/** Quick presets (relative to today) plus a calendar for any range. No range = all time. */
export function DateRangePicker({ from, to, onChange }: Props) {
  const [draft, setDraft] = useState<DateRange | undefined>(from && to ? { from, to } : undefined);
  const activePreset = PRESETS.find((p) => {
    const start = p.from();
    if (!start) return !from && !to;
    return !!from && !!to && differenceInCalendarDays(to, today()) === 0 && differenceInCalendarDays(from, start) === 0;
  })?.label;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Quick date ranges" className="flex flex-wrap gap-1 rounded-full border border-line bg-surface p-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            aria-pressed={activePreset === p.label}
            onClick={() => {
              const start = p.from();
              onChange(start ? { from: start, to: today() } : { from: null, to: null });
            }}
            className={cn(
              "min-h-9 rounded-full px-3.5 text-[13px] font-medium transition-colors",
              activePreset === p.label ? "bg-line text-text" : "text-muted hover:text-text",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <Popover
        trigger={(props) => (
          <button
            type="button"
            {...props}
            onClick={() => {
              setDraft(from && to ? { from, to } : undefined);
              props.onClick();
            }}
            className="flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-[14px] text-text hover:bg-surface"
          >
            <CalendarDays className="size-4 text-highlight" aria-hidden />
            {rangeLabel(from, to)}
            <ChevronDown className="size-4 text-faint" aria-hidden />
          </button>
        )}
      >
        {(close) => (
          <div className="rdp-brand">
            <DayPicker
              mode="range"
              selected={draft}
              onSelect={(range) => {
                setDraft(range);
                if (range?.from && range.to && range.from.getTime() !== range.to.getTime()) {
                  onChange({ from: range.from, to: range.to });
                  close();
                }
              }}
              defaultMonth={draft?.from ?? subDays(today(), 30)}
              disabled={{ after: today() }}
              weekStartsOn={1}
              captionLayout="dropdown"
              startMonth={new Date(2000, 0)}
              endMonth={today()}
            />
            <p className="px-2 pb-1 text-xs text-faint">Pick a start and an end date.</p>
          </div>
        )}
      </Popover>
    </div>
  );
}
