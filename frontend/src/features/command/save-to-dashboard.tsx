"use client";

import { Check, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ChartSpec } from "@/features/charts/chart-spec";
import { dashboardsApi } from "@/features/dashboards/api";
import { useDashboards } from "@/features/dashboards/hooks";

const NEW = "__new__";

/** Put an answer on an existing dashboard, or on a new one. */
export function SaveToDashboard({ spec }: { spec: ChartSpec }) {
  const { data: dashboards, refetch } = useDashboards();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<{ status: "idle" | "saving" | "done" | "error"; dashboardId?: string; error?: string }>({ status: "idle" });

  const save = async () => {
    setState({ status: "saving" });
    try {
      const id = target === NEW || !target ? (await dashboardsApi.create({ name: name.trim() || spec.title })).id : target;
      await dashboardsApi.addChart(id, { spec, kind: spec.chartType === "kpi" ? "kpi" : "card" });
      setState({ status: "done", dashboardId: id });
      void refetch();
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : "Couldn't save" });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setTarget(dashboards?.[0]?.id ?? NEW);
          setName("");
          setState({ status: "idle" });
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <LayoutDashboard /> Save to dashboard
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save to a dashboard</DialogTitle>
          <DialogDescription>“{spec.title}” will update with your data and the dashboard&apos;s filters.</DialogDescription>
        </DialogHeader>
        {state.status === "done" ? (
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-sm text-highlight" role="status">
              <Check className="size-4" /> Saved.
            </p>
            <Button nativeButton={false} render={<Link href={`/dashboards/${state.dashboardId}`} />}>
              Open dashboard
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field>
              <FieldLabel htmlFor="std-target">Dashboard</FieldLabel>
              <NativeSelect id="std-target" className="w-full" value={target} onChange={(e) => setTarget(e.target.value)}>
                {dashboards?.map((d) => (
                  <option key={d.id} value={d.id} className="bg-surface">
                    {d.name}
                  </option>
                ))}
                <option value={NEW} className="bg-surface">
                  + New dashboard…
                </option>
              </NativeSelect>
            </Field>
            {target === NEW && (
              <Field>
                <FieldLabel htmlFor="std-name">New dashboard name</FieldLabel>
                <Input id="std-name" value={name} maxLength={200} placeholder={spec.title} onChange={(e) => setName(e.target.value)} />
              </Field>
            )}
            {state.status === "error" && <p className="text-[13px] text-accent">{state.error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={state.status === "saving"}>
                {state.status === "saving" ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
