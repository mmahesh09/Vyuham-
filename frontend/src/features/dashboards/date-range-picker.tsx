"use client";

import "react-day-picker/style.css";

import { differenceInCalendarDays, format, isSameYear, startOfDay, startOfYear, subDays } from "date-fns";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useState } from "react";
import { DayPicker, type DateRange } from "react-day-picker";

import { Popover } from "@/components/ui/simple-popover";
import { SegmentedControl } from "@/components/app/segmented-control";

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
      {/* A custom range matches no preset, so nothing is pressed then. */}
      <SegmentedControl
        label="Quick date ranges"
        value={(activePreset ?? "") as string}
        onChange={(label) => {
          const start = PRESETS.find((p) => p.label === label)?.from();
          onChange(start ? { from: start, to: today() } : { from: null, to: null });
        }}
        options={PRESETS.map((p) => ({ value: p.label as string, label: p.label }))}
      />

      <Popover
        trigger={(props) => (
          <button
            type="button"
            {...props}
            onClick={() => {
              setDraft(from && to ? { from, to } : undefined);
              props.onClick();
            }}
            className="flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-[13.5px] text-text transition-colors hover:border-faint/50"
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
