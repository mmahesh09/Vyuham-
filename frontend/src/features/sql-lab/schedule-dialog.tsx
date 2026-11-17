"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { api } from "@/lib/api/client";

/** Mirrors ScheduleOut in backend/app/routers/sql_lab.py. */
export type Schedule = {
  id: string;
  schedule: "daily" | "weekly" | "monthly";
  hour: number;
  weekday: number;
  timezone: string;
  format: "csv" | "xlsx";
  only_if_rows: boolean;
  inapp: boolean;
  emails: string[];
  enabled: boolean;
  label: string;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};
const allZones = () => (typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"]);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null);

/** Run a saved query on a schedule and send the result (CSV or Excel) in Vyuham and by email. */
export function ScheduleDialog({ open, onOpenChange, savedId, name }: { open: boolean; onOpenChange: (o: boolean) => void; savedId: string; name: string }) {
  const qc = useQueryClient();
  const url = `/sql/saved/${savedId}/schedule`;
  const current = useQuery({ queryKey: ["sql", "schedule", savedId], queryFn: () => api<Schedule | null>(url), enabled: open });
  const zones = useMemo(() => allZones(), []);

  const [schedule, setSchedule] = useState<Schedule["schedule"]>("daily");
  const [hour, setHour] = useState(9);
  const [weekday, setWeekday] = useState(0);
  const [timezone, setTimezone] = useState(browserZone());
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [onlyIfRows, setOnlyIfRows] = useState(false);
  const [inapp, setInapp] = useState(true);
  const [emails, setEmails] = useState("");
  const [enabled, setEnabled] = useState(true);

  // Load the existing schedule into the form when the dialog opens.
  useEffect(() => {
    const s = current.data;
    if (!open || current.isPending) return;
    setSchedule(s?.schedule ?? "daily");
    setHour(s?.hour ?? 9);
    setWeekday(s?.weekday ?? 0);
    setTimezone(s?.timezone ?? browserZone());
    setFormat(s?.format ?? "csv");
    setOnlyIfRows(s?.only_if_rows ?? false);
    setInapp(s?.inapp ?? true);
    setEmails((s?.emails ?? []).join(", "));
    setEnabled(s?.enabled ?? true);
  }, [open, current.isPending, current.data]);

  const done = () => {
    qc.invalidateQueries({ queryKey: ["sql", "schedule", savedId] });
    qc.invalidateQueries({ queryKey: ["sql", "saved"] });
  };
  const save = useMutation({
    mutationFn: () =>
      api<Schedule>(url, {
        method: "PUT",
        body: JSON.stringify({
          schedule, hour, weekday, timezone, format, only_if_rows: onlyIfRows, inapp, enabled,
          emails: emails.split(/[,\s]+/).map((e) => e.trim()).filter(Boolean),
        }),
      }),
    onSuccess: () => {
      done();
      onOpenChange(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => api<void>(url, { method: "DELETE" }),
    onSuccess: () => {
      done();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 text-highlight" aria-hidden /> Schedule “{name}”
          </DialogTitle>
          <DialogDescription>Vyuham runs the saved query on schedule and sends the result as a file, with a preview of the first rows.</DialogDescription>
        </DialogHeader>

        {current.isPending ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[13px] text-muted">
                How often
                <NativeSelect value={schedule} onChange={(e) => setSchedule(e.target.value as Schedule["schedule"])}>
                  <option value="daily" className="bg-surface">Every day</option>
                  <option value="weekly" className="bg-surface">Every week</option>
                  <option value="monthly" className="bg-surface">Every month (on the 1st)</option>
                </NativeSelect>
              </label>
              {schedule === "weekly" && (
                <label className="flex flex-col gap-1 text-[13px] text-muted">
                  On
                  <NativeSelect value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                    {WEEKDAYS.map((d, i) => (
                      <option key={d} value={i} className="bg-surface">
                        {d}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              )}
              <label className="flex flex-col gap-1 text-[13px] text-muted">
                At
                <NativeSelect value={hour} onChange={(e) => setHour(Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h} className="bg-surface">
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="flex flex-col gap-1 text-[13px] text-muted sm:col-span-2">
                Time zone
                <NativeSelect value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {(zones.includes(timezone) ? zones : [timezone, ...zones]).map((z) => (
                    <option key={z} value={z} className="bg-surface">
                      {z}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="flex flex-col gap-1 text-[13px] text-muted">
                File
                <NativeSelect value={format} onChange={(e) => setFormat(e.target.value as "csv" | "xlsx")}>
                  <option value="csv" className="bg-surface">CSV</option>
                  <option value="xlsx" className="bg-surface">Excel (.xlsx)</option>
                </NativeSelect>
              </label>
            </div>

            <fieldset className="flex flex-col gap-2.5">
              <legend className="mb-1 text-[13px] text-muted">Send it to</legend>
              <label className="flex items-center gap-2 text-sm text-text">
                <Checkbox checked={inapp} onCheckedChange={(v) => setInapp(!!v)} /> Everyone in this workspace, in Vyuham
              </label>
              <label className="flex flex-col gap-1 text-[13px] text-muted">
                And by email (comma-separated)
                <Input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="owner@company.com, finance@company.com" />
              </label>
            </fieldset>

            <label className="flex items-center gap-2 text-sm text-text">
              <Checkbox checked={onlyIfRows} onCheckedChange={(v) => setOnlyIfRows(!!v)} /> Only send when the query returns rows
            </label>
            {current.data && (
              <label className="flex items-center gap-2 text-sm text-text">
                <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(!!v)} /> Schedule is on
              </label>
            )}

            {current.data && (
              <div className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-[12.5px] text-muted">
                <p>{current.data.label}</p>
                {current.data.next_run_at && <p>Next run: {when(current.data.next_run_at)}</p>}
                {current.data.last_run_at && (
                  <p>
                    Last run: {when(current.data.last_run_at)} · {current.data.last_status}
                  </p>
                )}
              </div>
            )}
            {(save.isError || remove.isError) && <p className="text-[13px] text-accent">{(save.error ?? remove.error)?.message}</p>}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {current.data ? (
            <Button variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Remove schedule
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={() => save.mutate()} disabled={save.isPending || current.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : null} {current.data ? "Save schedule" : "Schedule it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
