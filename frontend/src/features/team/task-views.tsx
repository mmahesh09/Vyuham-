"use client";

import { addDays, format, isBefore, parseISO, startOfDay } from "date-fns";
import { CalendarClock, Database, LayoutDashboard } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/reui/badge";
import { EventCalendar } from "@/components/reui/event-calendar/event-calendar";
import { EventCalendarContent } from "@/components/reui/event-calendar/event-calendar-content";
import { EventCalendarNav } from "@/components/reui/event-calendar/event-calendar-nav";
import type { CalendarEvent } from "@/components/reui/event-calendar/event-calendar-types";
import { Gantt } from "@/components/reui/gantt/gantt";
import { GanttNav } from "@/components/reui/gantt/gantt-nav";
import type { GanttEvent, GanttResource } from "@/components/reui/gantt/gantt-types";
import { GanttView } from "@/components/reui/gantt/gantt-view";
import { Kanban, KanbanBoard, KanbanColumn, KanbanColumnContent, KanbanItem, KanbanItemHandle, KanbanOverlay } from "@/components/reui/kanban";
import { useDashboards } from "@/features/dashboards/hooks";
import { useDatasets } from "@/features/datasets/api";
import { LEAVE_LABEL, PresenceAvatar } from "@/features/presence/status";
import type { Member } from "@/features/profile/api";
import { initials } from "@/features/profile/team-tree";
import { cn } from "@/lib/utils";

import { PRIORITY_LABEL, STATUS_LABEL, STATUSES, useOrderTasks, useUpdateTask, useWorkspaceLeaves, type Task, type TaskStatus } from "./api";

const PRIORITY_BADGE = { low: "outline", medium: "info-light", high: "warning-light", urgent: "destructive-light" } as const;
const PRIORITY_COLOR = { low: "#8f86b3", medium: "#705cbb", high: "#f2b544", urgent: "#f0597a" } as const;
const PROGRESS: Record<TaskStatus, number> = { todo: 0, in_progress: 40, review: 80, done: 100 };
const day = (iso: string) => startOfDay(parseISO(iso));

type ViewProps = { tasks: Task[]; members: Member[]; canEdit: boolean; meId: string; onOpen: (task: Task) => void };

/** Can this person move this task? Editors: any. Viewers: only their own. */
const movable = (t: Task, canEdit: boolean, meId: string) => canEdit || t.assignee_id === meId;

function TaskCard({ task, member, onOpen }: { task: Task; member?: Member; onOpen: () => void }) {
  const { data: datasets } = useDatasets();
  const { data: dashboards } = useDashboards();
  const overdue = task.due_date && task.status !== "done" && isBefore(day(task.due_date), startOfDay(new Date()));
  const ds = datasets?.find((d) => d.id === task.dataset_id);
  const db = dashboards?.find((d) => d.id === task.dashboard_id);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" ? onOpen() : undefined)}
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3 text-left hover:border-primary/60"
    >
      <span className={cn("text-sm font-medium", task.status === "done" && "text-muted line-through")}>{task.title}</span>
      {(ds || db) && (
        <span className="flex items-center gap-1.5 truncate text-[12px] text-muted">
          {ds ? <Database className="size-3.5 shrink-0 text-highlight" aria-hidden /> : <LayoutDashboard className="size-3.5 shrink-0 text-highlight" aria-hidden />}
          <span className="truncate">{ds?.name ?? db?.name}</span>
        </span>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Badge variant={PRIORITY_BADGE[task.priority]} size="sm">
            {PRIORITY_LABEL[task.priority]}
          </Badge>
          {task.due_date && (
            <span className={cn("flex items-center gap-1 text-[11px]", overdue ? "font-semibold text-accent" : "text-faint")}>
              <CalendarClock className="size-3" aria-hidden />
              {format(day(task.due_date), "MMM d")}
            </span>
          )}
        </div>
        {member ? (
          <span title={member.name}>
            <PresenceAvatar initials={initials(member.name)} status={member.status} size="sm" fallbackClassName="text-[10px]" />
          </span>
        ) : (
          <span className="text-[11px] text-faint">Unassigned</span>
        )}
      </div>
    </div>
  );
}

/** Kanban: drag between statuses. Each drop saves the columns that changed. */
export function TaskBoard({ tasks, members, canEdit, meId, onOpen }: ViewProps) {
  const order = useOrderTasks();
  const toColumns = (list: Task[]) =>
    Object.fromEntries(STATUSES.map((s) => [s, list.filter((t) => t.status === s).sort((a, b) => a.position - b.position)])) as Record<TaskStatus, Task[]>;
  const [columns, setColumns] = useState(() => toColumns(tasks));
  useEffect(() => setColumns(toColumns(tasks)), [tasks]);
  const byId = new Map(members.map((m) => [m.id, m]));

  return (
    <Kanban
      value={columns}
      onValueChange={(v) => setColumns(v as Record<TaskStatus, Task[]>)}
      getItemValue={(t) => t.id}
      onValueCommit={(next) => {
        const before = toColumns(tasks);
        for (const s of STATUSES) {
          const ids = (next[s] ?? []).map((t) => t.id);
          if (ids.join() !== before[s].map((t) => t.id).join()) order.mutate({ status: s, task_ids: ids });
        }
      }}
    >
      <KanbanBoard className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {STATUSES.map((s) => (
          <KanbanColumn key={s} value={s} className="flex flex-col gap-2 rounded-[16px] border border-line bg-bg/40 p-2.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-sm font-semibold">{STATUS_LABEL[s]}</span>
              <Badge variant="outline" size="sm">
                {columns[s]?.length ?? 0}
              </Badge>
            </div>
            <KanbanColumnContent value={s} className="flex min-h-24 flex-col gap-2">
              {(columns[s] ?? []).map((t) => (
                <KanbanItem key={t.id} value={t.id} disabled={!movable(t, canEdit, meId)}>
                  <KanbanItemHandle className="w-full cursor-grab">
                    <TaskCard task={t} member={t.assignee_id ? byId.get(t.assignee_id) : undefined} onOpen={() => onOpen(t)} />
                  </KanbanItemHandle>
                </KanbanItem>
              ))}
              {(columns[s]?.length ?? 0) === 0 && <p className="px-1 py-6 text-center text-xs text-faint">Drop tasks here</p>}
            </KanbanColumnContent>
          </KanbanColumn>
        ))}
      </KanbanBoard>
      <KanbanOverlay className="rounded-xl border-2 border-dashed border-primary/60 bg-line/20" />
    </Kanban>
  );
}

/** Gantt: one row per task, grouped by assignee. Drag or resize a bar to reschedule. */
export function TaskTimeline({ tasks, members, canEdit, meId, onOpen }: ViewProps) {
  const update = useUpdateTask();
  const scheduled = tasks.filter((t) => t.start_date || t.due_date);
  const unscheduled = tasks.length - scheduled.length;

  const resources: GanttResource[] = useMemo(() => {
    const groups = new Map<string, Task[]>();
    for (const t of scheduled) groups.set(t.assignee_id ?? "none", [...(groups.get(t.assignee_id ?? "none") ?? []), t]);
    return [...groups].map(([uid, list]) => ({
      id: `group-${uid}`,
      title: members.find((m) => m.id === uid)?.name ?? "Unassigned",
      children: list.map((t) => ({ id: t.id, title: t.title })),
    }));
  }, [scheduled, members]);

  const events: GanttEvent[] = useMemo(
    () =>
      scheduled.map((t) => {
        const start = day(t.start_date ?? t.due_date!);
        const end = addDays(day(t.due_date ?? t.start_date!), 1); // end is exclusive
        return {
          id: t.id,
          title: t.title,
          start,
          end,
          allDay: true,
          resourceId: t.id,
          color: PRIORITY_COLOR[t.priority],
          progress: PROGRESS[t.status],
          readOnly: !movable(t, canEdit, meId) || !canEdit,
        };
      }),
    [scheduled, canEdit, meId],
  );

  if (!scheduled.length)
    return <p className="rounded-[16px] border border-dashed border-line px-4 py-12 text-center text-sm text-muted">Give tasks a start or due date to see them on the timeline.</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-[16px] border border-line">
        <Gantt
          events={events}
          resources={resources}
          defaultScale="month"
          treePanel={{ width: 220 }}
          className="h-[480px] w-full"
          onEventClick={(occ) => {
            const t = tasks.find((x) => x.id === occ.event.id);
            if (t) onOpen(t);
          }}
          onEventUpdate={(u) => {
            update.mutate({ id: String(u.event.id), start_date: format(u.start, "yyyy-MM-dd"), due_date: format(addDays(u.end, -1), "yyyy-MM-dd") });
            return true;
          }}
        >
          <GanttNav className="border-b border-line" />
          <GanttView />
        </Gantt>
      </div>
      {unscheduled > 0 && <p className="text-xs text-faint">{unscheduled} task(s) without dates aren&apos;t shown.</p>}
    </div>
  );
}

type CalData = { kind: "task"; task: Task } | { kind: "leave" };

/** Month calendar: task due dates (drag to move) and everyone's leave. */
export function TeamCalendar({ tasks, canEdit, meId, onOpen }: ViewProps) {
  const update = useUpdateTask();
  const { data: leaves } = useWorkspaceLeaves();

  const events: CalendarEvent<CalData>[] = useMemo(() => {
    const out: CalendarEvent<CalData>[] = tasks
      .filter((t) => t.due_date)
      .map((t) => ({
        id: `task-${t.id}`,
        title: `${t.status === "done" ? "✓ " : ""}${t.title}`,
        start: day(t.due_date!),
        end: addDays(day(t.due_date!), 1),
        allDay: true,
        color: PRIORITY_COLOR[t.priority],
        readOnly: !movable(t, canEdit, meId) || !canEdit,
        data: { kind: "task", task: t },
      }));
    for (const lv of leaves ?? []) {
      out.push({
        id: `leave-${lv.id}`,
        title: `${lv.user_name} · ${LEAVE_LABEL[lv.leave_type]}${lv.backup_name ? ` (backup: ${lv.backup_name})` : ""}`,
        start: day(lv.start_date),
        end: addDays(day(lv.end_date), 1),
        allDay: true,
        color: "#ffaa44",
        readOnly: true,
        data: { kind: "leave" },
      });
    }
    return out;
  }, [tasks, leaves, canEdit, meId]);

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-[16px] border border-line">
        <EventCalendar
          events={events}
          defaultView="month"
          interactions={{ drag: true, resize: false, selectSlot: false }}
          className="h-[640px] w-full"
          onEventClick={(occ) => {
            const d = occ.event.data as CalData | undefined;
            if (d?.kind === "task") onOpen(d.task);
          }}
          onEventUpdate={(u) => {
            const d = u.event.data as CalData | undefined;
            if (d?.kind !== "task") return false;
            update.mutate({ id: d.task.id, due_date: format(u.start, "yyyy-MM-dd") });
            return true;
          }}
        >
          <EventCalendarNav className="border-b border-line" />
          <EventCalendarContent />
        </EventCalendar>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted">
        {(["urgent", "high", "medium", "low"] as const).map((p) => (
          <span key={p} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: PRIORITY_COLOR[p] }} aria-hidden /> {PRIORITY_LABEL[p]} task
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#ffaa44]" aria-hidden /> Leave
        </span>
      </div>
    </div>
  );
}
