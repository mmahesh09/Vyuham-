"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["Ctrl/⌘", "Enter"], label: "Run the query (or the selected part)" },
  { keys: ["Ctrl/⌘", "S"], label: "Save the query" },
  { keys: ["Shift", "Alt", "F"], label: "Format the SQL" },
  { keys: ["Ctrl/⌘", "B"], label: "Show or hide the schema panel" },
  { keys: ["Ctrl/⌘", "J"], label: "Show or hide the results panel" },
  { keys: ["Ctrl/⌘", "Space"], label: "Suggest tables and columns" },
  { keys: ["?"], label: "Show these shortcuts" },
];

/** Keyboard shortcuts for SQL Lab (opened with "?" or the keyboard button). */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Everything in SQL Lab works from the keyboard.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col divide-y divide-line">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
              <span className="text-muted">{s.label}</span>
              <span className="flex shrink-0 items-center gap-1">
                {s.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
