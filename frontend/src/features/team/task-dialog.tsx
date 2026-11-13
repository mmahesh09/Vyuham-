"use client";

import { format, parseISO } from "date-fns";
import { Plane, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDashboards } from "@/features/dashboards/hooks";
import { useDatasets } from "@/features/datasets/api";
import { LEAVE_LABEL } from "@/features/presence/status";
import { useMembers } from "@/features/profile/api";

import { PRIORITY_LABEL, STATUS_LABEL, STATUSES, useCreateTask, useDeleteTask, useUpdateTask, type Task, type TaskInput, type TaskPriority, type TaskStatus } from "./api";


type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this task, or create one with these defaults. */
  task?: Task | null;
  defaults?: TaskInput;
  canEdit: boolean;
};

const empty = (d?: TaskInput) => ({
  title: d?.title ?? "",
  description: d?.description ?? "",
  status: (d?.status ?? "todo") as TaskStatus,
  priority: (d?.priority ?? "medium") as TaskPriority,
  assignee_id: d?.assignee_id ?? "",
  start_date: d?.start_date ?? "",
  due_date: d?.due_date ?? "",
  dataset_id: d?.dataset_id ?? "",
  dashboard_id: d?.dashboard_id ?? "",
});

/** Create or edit a data task. Assigning someone on leave suggests their backup. */
export function TaskDialog({ open, onOpenChange, task, defaults, canEdit }: Props) {
  const { data: members } = useMembers();
  const { data: datasets } = useDatasets();
  const { data: dashboards } = useDashboards();
  const create = useCreateTask();
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const [form, setForm] = useState(empty(defaults));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(empty(task ?? defaults));
    setError(null);
  }, [open, task, defaults]);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const assignee = members?.find((m) => m.id === form.assignee_id);
  const onLeave = assignee?.status === "on_leave";
  const backup = onLeave ? members?.find((m) => m.name === assignee?.backup_name && m.id !== assignee?.id) : undefined;
  const pending = create.isPending || update.isPending;

  const submit = () => {
    if (!form.title.trim()) return setError("Give the task a title.");
    if (form.start_date && form.due_date && form.due_date < form.start_date) return setError("The due date can't be before the start date.");
    const body: TaskInput = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.status,
      priority: form.priority,
      assignee_id: form.assignee_id || null,
      start_date: form.start_date || null,
      due_date: form.due_date || null,
      dataset_id: form.dataset_id || null,
      dashboard_id: form.dashboard_id || null,
    };
    const done = { onSuccess: () => onOpenChange(false), onError: (e: Error) => setError(e.message) };
    if (task) update.mutate({ id: task.id, ...body }, done);
    else create.mutate(body, done);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? (canEdit ? "Edit task" : task.title) : "New data task"}</DialogTitle>
          <DialogDescription>{task ? "Changes are saved for the whole team." : "e.g. “Update the March sales file” or “Check the refunds chart”."}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <fieldset disabled={!canEdit} className="flex flex-col gap-4 disabled:opacity-80">
            <Field>
              <FieldLabel htmlFor="t-title">Title</FieldLabel>
              <Input id="t-title" autoFocus maxLength={200} value={form.title} onChange={(e) => set({ title: e.target.value })} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="t-desc">Details</FieldLabel>
              <Textarea id="t-desc" rows={2} maxLength={2000} value={form.description} onChange={(e) => set({ description: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="t-assignee">Assignee</FieldLabel>
                <NativeSelect id="t-assignee" className="w-full" value={form.assignee_id} onChange={(e) => set({ assignee_id: e.target.value })}>
                  <option value="" className="bg-surface">
                    Unassigned
                  </option>
                  {members?.map((m) => (
                    <option key={m.id} value={m.id} className="bg-surface">
                      {m.name}
                      {m.status === "on_leave" ? " (on leave)" : ""}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="t-priority">Priority</FieldLabel>
                <NativeSelect id="t-priority" className="w-full" value={form.priority} onChange={(e) => set({ priority: e.target.value as TaskPriority })}>
                  {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
                    <option key={p} value={p} className="bg-surface">
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            {onLeave && assignee && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#ffaa44]/40 bg-[#ffaa44]/10 px-3 py-2 text-[13px]">
                <span className="flex items-center gap-2">
                  <Plane className="size-4 text-[#ffaa44]" aria-hidden />
                  {assignee.name} is on {assignee.leave_type ? LEAVE_LABEL[assignee.leave_type].toLowerCase() : "leave"}
                  {assignee.leave_until ? ` until ${format(parseISO(assignee.leave_until), "MMM d")}` : ""}.
                  {assignee.backup_name ? ` Backup: ${assignee.backup_name}.` : ""}
                </span>
                {backup && (
                  <Button type="button" size="sm" variant="outline" onClick={() => set({ assignee_id: backup.id })}>
                    Assign to {backup.name.split(" ")[0]}
                  </Button>
                )}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="t-status">Status</FieldLabel>
                <NativeSelect id="t-status" className="w-full" value={form.status} onChange={(e) => set({ status: e.target.value as TaskStatus })}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s} className="bg-surface">
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="t-start">Start</FieldLabel>
                <Input id="t-start" type="date" className="[color-scheme:dark]" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="t-due">Due</FieldLabel>
                <Input id="t-due" type="date" className="[color-scheme:dark]" min={form.start_date || undefined} value={form.due_date} onChange={(e) => set({ due_date: e.target.value })} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="t-dataset">About dataset</FieldLabel>
                <NativeSelect id="t-dataset" className="w-full" value={form.dataset_id} onChange={(e) => set({ dataset_id: e.target.value })}>
                  <option value="" className="bg-surface">
                    None
                  </option>
                  {datasets?.map((d) => (
                    <option key={d.id} value={d.id} className="bg-surface">
                      {d.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="t-dashboard">About dashboard</FieldLabel>
                <NativeSelect id="t-dashboard" className="w-full" value={form.dashboard_id} onChange={(e) => set({ dashboard_id: e.target.value })}>
                  <option value="" className="bg-surface">
                    None
                  </option>
                  {dashboards?.map((d) => (
                    <option key={d.id} value={d.id} className="bg-surface">
                      {d.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          </fieldset>
          {error && <p className="text-[13px] text-accent">{error}</p>}
          {canEdit && (
            <DialogFooter className="flex-row items-center justify-between sm:justify-between">
              {task ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-accent"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(task.id, { onSuccess: () => onOpenChange(false) })}
                >
                  <Trash2 /> Delete
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : task ? "Save" : "Create task"}
              </Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
