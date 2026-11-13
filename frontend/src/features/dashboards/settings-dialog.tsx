"use client";

import { SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import type { Dashboard } from "./api";
import { useDashboardMutations } from "./hooks";

/** Name, description, which date column each dataset filters on, and which columns get a dropdown filter. */
export function SettingsDialog({
  dashboard,
  open: controlledOpen,
  onOpenChange,
}: {
  dashboard: Dashboard;
  /** Pass to open it from elsewhere (a menu item); no trigger button is rendered then. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { update } = useDashboardMutations(dashboard.id);
  const [innerOpen, setInnerOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : innerOpen;
  const setOpen = (o: boolean) => (controlled ? onOpenChange?.(o) : setInnerOpen(o));
  const [name, setName] = useState(dashboard.name);
  const [description, setDescription] = useState(dashboard.description ?? "");
  const [dateFields, setDateFields] = useState(dashboard.date_fields);
  const [filters, setFilters] = useState<string[]>(dashboard.filter_columns);

  // Columns that make sensible dropdown filters: categories and text, from any dataset on the dashboard.
  const candidates = [...new Set(dashboard.datasets.flatMap((d) => d.columns.filter((c) => c.type === "category" || c.type === "text").map((c) => c.name)))];

  // Start from the saved values every time it opens, however it was opened.
  useEffect(() => {
    if (!open) return;
    setName(dashboard.name);
    setDescription(dashboard.description ?? "");
    setDateFields(dashboard.date_fields);
    setFilters(dashboard.filter_columns);
    update.reset();
    // Only on opening: later edits to the dashboard shouldn't overwrite what's being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled && (
        <DialogTrigger render={<Button variant="outline" size="icon" aria-label="Dashboard settings" />}>
          <SlidersHorizontal />
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dashboard settings</DialogTitle>
          <DialogDescription>Changes apply for everyone who opens this dashboard.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            update.mutate(
              { name: name.trim(), description: description.trim() || null, date_fields: dateFields, filter_columns: filters },
              { onSuccess: () => setOpen(false) },
            );
          }}
        >
          <Field>
            <FieldLabel htmlFor="ds-name">Name</FieldLabel>
            <Input id="ds-name" value={name} maxLength={200} required onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ds-desc">Description</FieldLabel>
            <Textarea id="ds-desc" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>

          {dashboard.datasets.map((d) => {
            const dates = d.columns.filter((c) => c.type === "date");
            if (!dates.length) return null;
            return (
              <Field key={d.id}>
                <FieldLabel htmlFor={`ds-date-${d.id}`}>Date filter uses ({d.name})</FieldLabel>
                <NativeSelect
 id={`ds-date-${d.id}`}
                  className="w-full"
                  value={dateFields[d.id] ?? ""}
                  onChange={(e) => {
                    const next = { ...dateFields };
                    if (e.target.value) next[d.id] = e.target.value;
                    else delete next[d.id];
                    setDateFields(next);
                  }}
                >
                  <option value="" className="bg-surface">
                    Don&apos;t filter this dataset by date
                  </option>
                  {dates.map((c) => (
                    <option key={c.name} value={c.name} className="bg-surface">
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            );
          })}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Filters in the bar</legend>
            {candidates.length === 0 ? (
              <FieldDescription>Add a chart from a dataset with category columns to filter by them.</FieldDescription>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {candidates.map((c) => (
                  <label key={c} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={filters.includes(c)}
                      disabled={!filters.includes(c) && filters.length >= 6}
                      onChange={(e) => setFilters(e.target.checked ? [...filters, c] : filters.filter((x) => x !== c))}
                    />
                    <span className="truncate">{c}</span>
                  </label>
                ))}
              </div>
            )}
            <FieldDescription>Up to 6. Each filter applies to every chart whose dataset has that column.</FieldDescription>
          </fieldset>

          {update.isError && <p className="text-[13px] text-accent">{update.error.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
