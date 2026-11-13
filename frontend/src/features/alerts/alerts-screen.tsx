"use client";

import { formatDistanceToNow } from "date-fns";
import { BellRing, CalendarClock, Pencil, Play, Send, Trash2 } from "lucide-react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useEffect, useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/features/auth/hooks";
import { formatNumber } from "@/features/charts/build-option";
import { AGG_LABEL, ROW_FIELD, type Aggregation } from "@/features/charts/chart-spec";
import { useDashboards } from "@/features/dashboards/hooks";
import { useDatasets } from "@/features/datasets/api";

import {
  CONDITION_LABEL,
  useAlerts,
  useAutomations,
  useCheckAlert,
  useDeleteAlert,
  useDeleteAutomation,
  useHistory,
  useRunAutomation,
  useSaveAlert,
  useSaveAutomation,
  type Alert,
  type AlertInput,
  type Automation,
  type AutomationInput,
  type Channels,
  type Condition,
} from "./api";
import { ChannelsField } from "./channels-field";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TABS = ["alerts", "automations", "history"] as const;
const defaultChannels: Channels = { inapp: true, emails: [], webhook: null };
const localZone = () => (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC");

// ---------- alert editor ----------

function AlertDialog({ open, onOpenChange, alert }: { open: boolean; onOpenChange: (o: boolean) => void; alert: Alert | null }) {
  const { data: datasets } = useDatasets();
  const save = useSaveAlert();
  const [form, setForm] = useState<AlertInput | null>(null);

  useEffect(() => {
    if (!open) return;
    save.reset();
    if (alert) {
      const { id: _id, state: _s, last_value: _v, last_checked_at: _c, last_triggered_at: _t, last_error: _e, created_at: _ca, ...rest } = alert;
      setForm({ ...rest, dataset_id: alert.dataset_id ?? datasets?.[0]?.id ?? "" });
      return;
    }
    const ds = datasets?.[0];
    const num = ds?.columns.find((c) => c.type === "number");
    setForm({
      name: "",
      dataset_id: ds?.id ?? "",
      metric: num ? { field: num.name, agg: "sum" } : { field: ROW_FIELD, agg: "count" },
      filters: [],
      date_field: ds?.columns.find((c) => c.type === "date")?.name ?? null,
      window_days: 7,
      condition: "below",
      threshold: 0,
      schedule: "daily",
      channels: defaultChannels,
      enabled: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open, alert, datasets]);

  if (!form) return null;
  const ds = datasets?.find((d) => d.id === form.dataset_id);
  const set = (patch: Partial<AlertInput>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const isNumber = ds?.columns.find((c) => c.name === form.metric.field)?.type === "number";
  const aggs: Aggregation[] = form.metric.field === ROW_FIELD ? ["count"] : isNumber ? ["sum", "avg", "min", "max", "count", "count_distinct"] : ["count", "count_distinct"];
  const isChange = form.condition.startsWith("change");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{alert ? "Edit alert" : "New alert"}</DialogTitle>
          <DialogDescription>Watch one number and get told when it crosses a line. It notifies once, then waits until things are back to normal.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ ...form, id: alert?.id, name: form.name.trim() || "Untitled alert" }, { onSuccess: () => onOpenChange(false) });
          }}
        >
          <Field>
            <FieldLabel htmlFor="al-name">Name</FieldLabel>
            <Input id="al-name" maxLength={200} placeholder="e.g. Weekly revenue dip" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field className="sm:col-span-3">
              <FieldLabel htmlFor="al-ds">Dataset</FieldLabel>
              <NativeSelect
 id="al-ds"
                className="w-full"
                value={form.dataset_id}
                onChange={(e) => {
                  const next = datasets?.find((d) => d.id === e.target.value);
                  const num = next?.columns.find((c) => c.type === "number");
                  set({
                    dataset_id: e.target.value,
                    metric: num ? { field: num.name, agg: "sum" } : { field: ROW_FIELD, agg: "count" },
                    date_field: next?.columns.find((c) => c.type === "date")?.name ?? null,
                  });
                }}
              >
                {datasets?.map((d) => (
                  <option key={d.id} value={d.id} className="bg-surface">
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="al-field">Measure</FieldLabel>
              <NativeSelect
 id="al-field"
                className="w-full"
                value={form.metric.field}
                onChange={(e) => {
                  const f = e.target.value;
                  const num = ds?.columns.find((c) => c.name === f)?.type === "number";
                  set({ metric: { field: f, agg: f === ROW_FIELD ? "count" : num ? "sum" : "count_distinct" } });
                }}
              >
                <option value={ROW_FIELD} className="bg-surface">
                  Number of rows
                </option>
                {ds?.columns.map((c) => (
                  <option key={c.name} value={c.name} className="bg-surface">
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="al-agg">As</FieldLabel>
              <NativeSelect id="al-agg" className="w-full" value={form.metric.agg} onChange={(e) => set({ metric: { ...form.metric, agg: e.target.value as Aggregation } })}>
                {aggs.map((a) => (
                  <option key={a} value={a} className="bg-surface">
                    {AGG_LABEL[a]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="al-window">Over</FieldLabel>
              <NativeSelect id="al-window" className="w-full" value={form.date_field ? form.window_days : 0} onChange={(e) => set({ window_days: Number(e.target.value) })} disabled={!form.date_field}>
                <option value={0} className="bg-surface">All time</option>
                <option value={1} className="bg-surface">Today</option>
                <option value={7} className="bg-surface">The last 7 days</option>
                <option value={30} className="bg-surface">The last 30 days</option>
                <option value={90} className="bg-surface">The last 90 days</option>
              </NativeSelect>
              {!form.date_field && <FieldDescription>This dataset has no date column, so it looks at all rows.</FieldDescription>}
            </Field>
            <Field>
              <FieldLabel htmlFor="al-cond">Alert when it</FieldLabel>
              <NativeSelect id="al-cond" className="w-full" value={form.condition} onChange={(e) => set({ condition: e.target.value as Condition })}>
                {(Object.keys(CONDITION_LABEL) as Condition[]).map((c) => (
                  <option key={c} value={c} className="bg-surface" disabled={c.startsWith("change") && (!form.date_field || !form.window_days)}>
                    {CONDITION_LABEL[c]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="al-threshold">{isChange ? "By (%)" : "Threshold"}</FieldLabel>
              <Input id="al-threshold" type="number" inputMode="decimal" value={form.threshold} onChange={(e) => set({ threshold: Number(e.target.value) })} />
              {isChange && <FieldDescription>Compared with the {form.window_days} days before.</FieldDescription>}
            </Field>
            <Field>
              <FieldLabel htmlFor="al-sched">Check</FieldLabel>
              <NativeSelect id="al-sched" className="w-full" value={form.schedule} onChange={(e) => set({ schedule: e.target.value as AlertInput["schedule"] })}>
                <option value="hourly" className="bg-surface">Every hour</option>
                <option value="daily" className="bg-surface">Every day</option>
                <option value="weekly" className="bg-surface">Every week</option>
              </NativeSelect>
            </Field>
          </div>
          <ChannelsField value={form.channels} onChange={(channels) => set({ channels })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            Active
          </label>
          {save.isError && <p className="text-[13px] text-accent">{save.error.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending || !form.dataset_id}>
              {save.isPending ? "Saving…" : alert ? "Save alert" : "Create alert"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- automation editor ----------

function AutomationDialog({ open, onOpenChange, automation }: { open: boolean; onOpenChange: (o: boolean) => void; automation: Automation | null }) {
  const { data: dashboards } = useDashboards();
  const save = useSaveAutomation();
  const [form, setForm] = useState<AutomationInput | null>(null);

  useEffect(() => {
    if (!open) return;
    save.reset();
    if (automation) {
      const { id: _i, last_run_at: _l, last_status: _s, created_at: _c, ...rest } = automation;
      setForm({ ...rest, dashboard_id: automation.dashboard_id ?? dashboards?.[0]?.id ?? "" });
    } else {
      setForm({
        name: "",
        kind: "dashboard_digest",
        dashboard_id: dashboards?.[0]?.id ?? "",
        schedule: "weekly",
        hour: 9,
        weekday: 0,
        timezone: localZone(),
        period_days: 7,
        channels: defaultChannels,
        enabled: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open, automation, dashboards]);

  if (!form) return null;
  const set = (patch: Partial<AutomationInput>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{automation ? "Edit automation" : "New automation"}</DialogTitle>
          <DialogDescription>Send a dashboard&apos;s headlines on a schedule: the key numbers and what stands out, as plain sentences.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const name = form.name.trim() || `${dashboards?.find((d) => d.id === form.dashboard_id)?.name ?? "Dashboard"} digest`;
            save.mutate({ ...form, id: automation?.id, name }, { onSuccess: () => onOpenChange(false) });
          }}
        >
          <Field>
            <FieldLabel htmlFor="au-name">Name</FieldLabel>
            <Input id="au-name" maxLength={200} placeholder="e.g. Monday sales digest" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="au-dash">Dashboard</FieldLabel>
            <NativeSelect id="au-dash" className="w-full" value={form.dashboard_id} onChange={(e) => set({ dashboard_id: e.target.value })}>
              {dashboards?.map((d) => (
                <option key={d.id} value={d.id} className="bg-surface">
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="au-sched">Every</FieldLabel>
              <NativeSelect id="au-sched" className="w-full" value={form.schedule} onChange={(e) => set({ schedule: e.target.value as AutomationInput["schedule"] })}>
                <option value="daily" className="bg-surface">Day</option>
                <option value="weekly" className="bg-surface">Week</option>
                <option value="monthly" className="bg-surface">Month (1st)</option>
              </NativeSelect>
            </Field>
            {form.schedule === "weekly" && (
              <Field>
                <FieldLabel htmlFor="au-day">On</FieldLabel>
                <NativeSelect id="au-day" className="w-full" value={form.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                  {DAYS.map((d, i) => (
                    <option key={d} value={i} className="bg-surface">
                      {d}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="au-hour">At</FieldLabel>
              <NativeSelect id="au-hour" className="w-full" value={form.hour} onChange={(e) => set({ hour: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h} className="bg-surface">
                    {`${String(h).padStart(2, "0")}:00`}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="au-period">Covering the last</FieldLabel>
              <NativeSelect id="au-period" className="w-full" value={form.period_days} onChange={(e) => set({ period_days: Number(e.target.value) })}>
                {[1, 7, 30, 90].map((n) => (
                  <option key={n} value={n} className="bg-surface">
                    {n === 1 ? "day" : `${n} days`}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="au-tz">Time zone</FieldLabel>
              <Input id="au-tz" value={form.timezone} onChange={(e) => set({ timezone: e.target.value })} />
            </Field>
          </div>
          <ChannelsField value={form.channels} onChange={(channels) => set({ channels })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            Active
          </label>
          {save.isError && <p className="text-[13px] text-accent">{save.error.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending || !form.dashboard_id}>
              {save.isPending ? "Saving…" : automation ? "Save automation" : "Create automation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- screen ----------

const STATE_BADGE = { ok: ["success-light", "Normal"], triggered: ["warning-light", "Triggered"], error: ["destructive-light", "Needs attention"] } as const;

export function AlertsScreen() {
  const { data: me } = useMe();
  const canEdit = me?.role !== "viewer";
  const alerts = useAlerts();
  const automations = useAutomations();
  const history = useHistory();
  const { data: datasets } = useDatasets();
  const { data: dashboards } = useDashboards();
  const check = useCheckAlert();
  const delAlert = useDeleteAlert();
  const run = useRunAutomation();
  const delAuto = useDeleteAutomation();
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault("alerts"));
  const [alertDialog, setAlertDialog] = useState<{ open: boolean; alert: Alert | null }>({ open: false, alert: null });
  const [autoDialog, setAutoDialog] = useState<{ open: boolean; automation: Automation | null }>({ open: false, automation: null });
  const actionError = (check.error ?? run.error)?.message;

  return (
    <PageContainer className="gap-6">
      <PageHeader
        title="Alerts & automations"
        description="Get told when a number moves, and send dashboards to people on a schedule."
        actions={
          <>
            {canEdit && (
              <div className="flex gap-2">
                <Button onClick={() => setAlertDialog({ open: true, alert: null })} disabled={!datasets?.length}>
                  <BellRing /> New alert
                </Button>
                <Button variant="outline" onClick={() => setAutoDialog({ open: true, automation: null })} disabled={!dashboards?.length}>
                  <CalendarClock /> New automation
                </Button>
              </div>
            )}
          </>
        }
      />
      {actionError && <p className="text-sm text-accent">{actionError}</p>}

      <Tabs value={tab} onValueChange={(v) => void setTab(v as (typeof TABS)[number])}>
        <TabsList>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="automations">Automations</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="alerts" className="pt-4">
          {!alerts.data?.length ? (
            <Empty className="border border-dashed border-line py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BellRing />
                </EmptyMedia>
                <EmptyTitle>No alerts yet</EmptyTitle>
                <EmptyDescription>e.g. &ldquo;tell me when revenue over the last 7 days drops below 50,000&rdquo;.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-[16px] border border-line">
              {alerts.data.map((a) => {
                const [variant, label] = STATE_BADGE[a.state];
                const dsName = datasets?.find((d) => d.id === a.dataset_id)?.name ?? "deleted dataset";
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-2 font-medium">
                        {a.name}
                        <Badge variant={variant} size="sm">{label}</Badge>
                        {!a.enabled && <Badge variant="outline" size="sm">Paused</Badge>}
                      </span>
                      <span className="text-[13px] text-muted">
                        {a.metric.field === ROW_FIELD ? "Rows" : `${AGG_LABEL[a.metric.agg]} ${a.metric.field}`}
                        {a.date_field && a.window_days ? ` (last ${a.window_days} days)` : ""} {CONDITION_LABEL[a.condition].replace(" (%)", "")} {a.condition.startsWith("change") ? `${a.threshold}%` : formatNumber(a.threshold)} · {dsName} · checked {a.schedule}
                      </span>
                      <span className="text-xs text-faint">
                        {a.last_error
                          ? a.last_error
                          : a.last_checked_at
                            ? `Last value ${formatNumber(a.last_value)} · checked ${formatDistanceToNow(new Date(a.last_checked_at), { addSuffix: true })}`
                            : "Not checked yet"}
                      </span>
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" disabled={check.isPending} onClick={() => check.mutate({ id: a.id })}>
                          <Play /> Check now
                        </Button>
                        <Button variant="ghost" size="sm" disabled={check.isPending} onClick={() => check.mutate({ id: a.id, test: true })} title="Send the message now, even if the rule isn't met">
                          <Send /> Test
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${a.name}`} onClick={() => setAlertDialog({ open: true, alert: a })}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${a.name}`} onClick={() => window.confirm(`Delete the alert “${a.name}”?`) && delAlert.mutate(a.id)}>
                          <Trash2 />
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="automations" className="pt-4">
          {!automations.data?.length ? (
            <Empty className="border border-dashed border-line py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarClock />
                </EmptyMedia>
                <EmptyTitle>No automations yet</EmptyTitle>
                <EmptyDescription>e.g. send the Sales dashboard&apos;s headlines every Monday at 9:00.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-[16px] border border-line">
              {automations.data.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2 font-medium">
                      {a.name}
                      {!a.enabled && <Badge variant="outline" size="sm">Paused</Badge>}
                    </span>
                    <span className="text-[13px] text-muted">
                      {dashboards?.find((d) => d.id === a.dashboard_id)?.name ?? "Deleted dashboard"} · every{" "}
                      {a.schedule === "weekly" ? DAYS[a.weekday] : a.schedule === "monthly" ? "1st of the month" : "day"} at {String(a.hour).padStart(2, "0")}:00 ({a.timezone})
                    </span>
                    <span className="text-xs text-faint">
                      {a.last_run_at ? `${a.last_status ?? "Ran"} ${formatDistanceToNow(new Date(a.last_run_at), { addSuffix: true })}` : "Hasn't run yet"}
                    </span>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm" disabled={run.isPending} onClick={() => run.mutate(a.id)}>
                        <Send /> Send now
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${a.name}`} onClick={() => setAutoDialog({ open: true, automation: a })}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${a.name}`} onClick={() => window.confirm(`Delete “${a.name}”?`) && delAuto.mutate(a.id)}>
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="history" className="pt-4">
          {!history.data?.length ? (
            <p className="text-sm text-faint">Nothing sent yet. Alerts appear here when they fire, automations when they run.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {history.data.map((e) => (
                <li key={e.id} className="flex flex-col gap-1.5 rounded-[14px] border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-medium">
                      {e.alert_id ? <BellRing className="size-4 text-[#ffaa44]" aria-hidden /> : <CalendarClock className="size-4 text-highlight" aria-hidden />}
                      {e.title}
                    </span>
                    <span className="text-xs text-faint">{formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}</span>
                  </div>
                  <p className="whitespace-pre-line text-[13px] text-muted">{e.body}</p>
                  <p className="text-[11px] text-faint">
                    Delivered:{" "}
                    {Object.entries(e.delivery)
                      .map(([k, v]) => `${k === "inapp" ? "in-app" : k} ${typeof v === "number" ? `×${v}` : v}`)
                      .join(" · ") || "nowhere"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={alertDialog.open} onOpenChange={(o) => setAlertDialog((s) => ({ ...s, open: o }))} alert={alertDialog.alert} />
      <AutomationDialog open={autoDialog.open} onOpenChange={(o) => setAutoDialog((s) => ({ ...s, open: o }))} automation={autoDialog.automation} />
    </PageContainer>
  );
}
